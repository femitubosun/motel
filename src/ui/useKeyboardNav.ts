import { useAtom } from "@effect/atom-react"
import { useKeyboard, useRenderer } from "@opentui/react"
import { useEffect, useLayoutEffect, useRef } from "react"
import type { TraceItem, TraceSummaryItem } from "../domain.ts"
import { otelServerInstructions } from "../instructions.ts"
import { copyToClipboard, traceUiUrl, webUiUrl } from "./format.ts"
import {
	activeAttrKeyAtom,
	activeAttrValueAtom,
	attrFacetStateAtom,
	attrPickerIndexAtom,
	attrPickerInputAtom,
	attrPickerModeAtom,
	autoRefreshAtom,
	collapsedSpanIdsAtom,
	detailViewAtom,
	filterModeAtom,
	filterTextAtom,
	refreshNonceAtom,
	selectedAttrIndexAtom,
	selectedThemeAtom,
	selectedServiceLogIndexAtom,
	selectedSpanIndexAtom,
	selectedTraceIndexAtom,
	selectedTraceServiceAtom,
	serviceLogStateAtom,
	showHelpAtom,
	traceSortAtom,
	type TraceSortMode,
	traceStateAtom,
	waterfallFilterModeAtom,
	waterfallFilterTextAtom,
} from "./state.ts"
import { filterFacets } from "./AttrFilterModal.tsx"
import { G_PREFIX_TIMEOUT_MS } from "./theme.ts"
import { cycleThemeName, themeLabel } from "./theme.ts"
import { getVisibleSpans } from "./Waterfall.tsx"
import { computeMatchingSpanIds, findAdjacentMatch } from "./waterfallFilter.ts"
import { resolveCollapseStep } from "./waterfallNav.ts"

/**
 * Pull a printable string out of a key event. Handles two cases:
 *
 * 1. A plain printable key (1 char) — returns the char.
 * 2. A multi-char sequence that arrived as one event (common when the
 *    terminal has bracketed paste disabled but the user pasted quickly and
 *    opentui's parser returned the whole buffer as one key). Returns the
 *    sanitised sequence with control bytes stripped.
 *
 * Returns `null` for non-printable events (function keys, modifiers, etc.)
 * so callers can skip them.
 */
const extractPrintable = (key: {
	readonly name: string
	readonly sequence?: string
	readonly ctrl: boolean
	readonly meta: boolean
}): string | null => {
	if (key.ctrl || key.meta) return null
	// Space arrives as `key.name === "space"` with a 1-char sequence. We
	// handle it explicitly because the generic "length > 1" branch below
	// only catches multi-char paste sequences, not a lone " ".
	if (key.name === "space") return " "
	if (key.name.length === 1) return key.name
	const seq = key.sequence ?? ""
	// Only accept sequences that are pure printable text. Any escape or
	// control byte means this was a function / navigation key.
	if (seq.length > 1 && !/[\x00-\x1f\x7f]/.test(seq)) return seq
	return null
}

interface KeyboardNavParams {
	selectedTrace: TraceItem | null
	filteredTraces: readonly TraceSummaryItem[]
	isWideLayout: boolean
	wideBodyLines: number
	narrowBodyLines: number
	tracePageSize: number
	spanPageSize: number
	flashNotice: (message: string) => void
}

export const useKeyboardNav = (params: KeyboardNavParams) => {
	const {
		selectedTrace,
		isWideLayout,
		wideBodyLines,
		narrowBodyLines,
		tracePageSize,
		spanPageSize,
		flashNotice,
	} = params
	const renderer = useRenderer()

	const [traceState] = useAtom(traceStateAtom)
	const [serviceLogState] = useAtom(serviceLogStateAtom)
	const [selectedSpanIndex, setSelectedSpanIndex] = useAtom(selectedSpanIndexAtom)
	const [selectedServiceLogIndex, setSelectedServiceLogIndex] = useAtom(selectedServiceLogIndexAtom)
	const [selectedTheme, setSelectedTheme] = useAtom(selectedThemeAtom)
	const [selectedTraceIndex, setSelectedTraceIndex] = useAtom(selectedTraceIndexAtom)
	const [selectedTraceService, setSelectedTraceService] = useAtom(selectedTraceServiceAtom)
	const [detailView, setDetailView] = useAtom(detailViewAtom)
	const [showHelp, setShowHelp] = useAtom(showHelpAtom)
	const [, setRefreshNonce] = useAtom(refreshNonceAtom)
	const [collapsedSpanIds, setCollapsedSpanIds] = useAtom(collapsedSpanIdsAtom)
	const [autoRefresh, setAutoRefresh] = useAtom(autoRefreshAtom)
	const [filterMode, setFilterMode] = useAtom(filterModeAtom)
	const [filterText, setFilterText] = useAtom(filterTextAtom)
	const [traceSort, setTraceSort] = useAtom(traceSortAtom)
	const [pickerMode, setPickerMode] = useAtom(attrPickerModeAtom)
	const [pickerInput, setPickerInput] = useAtom(attrPickerInputAtom)
	const [pickerIndex, setPickerIndex] = useAtom(attrPickerIndexAtom)
	const [attrFacets] = useAtom(attrFacetStateAtom)
	const [activeAttrKey, setActiveAttrKey] = useAtom(activeAttrKeyAtom)
	const [activeAttrValue, setActiveAttrValue] = useAtom(activeAttrValueAtom)
	const [waterfallFilterMode, setWaterfallFilterMode] = useAtom(waterfallFilterModeAtom)
	const [waterfallFilterText, setWaterfallFilterText] = useAtom(waterfallFilterTextAtom)
	const [selectedAttrIndex, setSelectedAttrIndex] = useAtom(selectedAttrIndexAtom)

	const pendingGRef = useRef(false)
	const pendingGTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const quittingRef = useRef(false)

	const spanNavActive = detailView !== "service-logs" && selectedSpanIndex !== null
	const serviceLogNavActive = detailView === "service-logs"
	// L2 (full-screen content view): j/k/y/gg/G operate on the tag list
	// instead of the waterfall or trace list. Enter drilled us here from
	// L1; esc drills back.
	const attrNavActive = detailView === "span-detail" && selectedSpanIndex !== null

	// Bracketed paste: when the terminal has bracketed paste enabled, opentui
	// surfaces the full pasted text as a single "paste" event on keyInput.
	// Route it into whichever input is currently open. We also enable the
	// mode ourselves (`\x1b[?2004h`) in case the host terminal didn't — it's
	// a no-op on terminals that already had it on.
	useEffect(() => {
		const keyInput = (renderer as unknown as { keyInput?: { on: (event: string, handler: (e: unknown) => void) => void; off: (event: string, handler: (e: unknown) => void) => void } }).keyInput
		if (!keyInput) return
		try {
			process.stdout.write("\x1b[?2004h")
		} catch {
			// Best effort — some test environments don't have a real TTY.
		}
		const handler = (event: unknown) => {
			const bytes = (event as { bytes?: Uint8Array }).bytes
			if (!bytes || bytes.length === 0) return
			const text = Buffer.from(bytes).toString("utf8").replace(/[\x00-\x1f\x7f]+/g, (match) => match === "\n" ? " " : "")
			if (!text) return
			const s = stateRef.current
			if (s.pickerMode !== "off") {
				setPickerInput((current) => current + text)
				setPickerIndex(0)
				return
			}
			if (s.filterMode) {
				setFilterText((current) => current + text)
				return
			}
		}
		keyInput.on("paste", handler)
		return () => {
			keyInput.off("paste", handler)
			try {
				process.stdout.write("\x1b[?2004l")
			} catch {}
		}
	}, [renderer, setFilterText, setPickerInput, setPickerIndex])

	const stateRef = useRef({ traceState, serviceLogState, selectedServiceLogIndex, selectedTheme, selectedTraceIndex, selectedSpanIndex, selectedTraceService, detailView, showHelp, collapsedSpanIds, spanNavActive, serviceLogNavActive, attrNavActive, selectedAttrIndex, filterMode, filterText, autoRefresh, traceSort, pickerMode, pickerInput, pickerIndex, attrFacets, activeAttrKey, activeAttrValue, waterfallFilterMode, waterfallFilterText, ...params })
	// Keep the keyboard handler's state mirror in sync before the next paint.
	// OpenTUI's own effect-event helper uses useLayoutEffect for this same reason:
	// rapid repeated keypresses can otherwise observe stale selection state.
	useLayoutEffect(() => {
		stateRef.current = { traceState, serviceLogState, selectedServiceLogIndex, selectedTheme, selectedTraceIndex, selectedSpanIndex, selectedTraceService, detailView, showHelp, collapsedSpanIds, spanNavActive, serviceLogNavActive, attrNavActive, selectedAttrIndex, filterMode, filterText, autoRefresh, traceSort, pickerMode, pickerInput, pickerIndex, attrFacets, activeAttrKey, activeAttrValue, waterfallFilterMode, waterfallFilterText, ...params }
	})

	const clearPendingG = () => {
		pendingGRef.current = false
		if (pendingGTimeoutRef.current !== null) {
			clearTimeout(pendingGTimeoutRef.current)
			pendingGTimeoutRef.current = null
		}
	}

	const armPendingG = () => {
		clearPendingG()
		pendingGRef.current = true
		pendingGTimeoutRef.current = globalThis.setTimeout(() => {
			pendingGRef.current = false
			pendingGTimeoutRef.current = null
		}, G_PREFIX_TIMEOUT_MS)
	}

	const $ = () => stateRef.current

	const selectFilteredTraceAt = (filteredIdx: number) => {
		const s = $()
		const trace = s.filteredTraces[filteredIdx]
		if (!trace) return
		const fullIndex = s.traceState.data.findIndex((t) => t.traceId === trace.traceId)
		if (fullIndex >= 0) setSelectedTraceIndex(fullIndex)
	}

	const attrCountForSelectedSpan = () => {
		const s = $()
		if (!s.selectedTrace || s.selectedSpanIndex === null) return 0
		const visible = getVisibleSpans(s.selectedTrace.spans, s.collapsedSpanIds)
		const span = visible[s.selectedSpanIndex]
		return span ? Object.keys(span.tags).length : 0
	}

	const jumpToStart = () => {
		const s = $()
		if (s.attrNavActive) {
			setSelectedAttrIndex(0)
			return
		}
		if (s.spanNavActive && s.selectedTrace) {
			const visibleCount = getVisibleSpans(s.selectedTrace.spans, s.collapsedSpanIds).length
			setSelectedSpanIndex(visibleCount === 0 ? null : 0)
		} else {
			selectFilteredTraceAt(0)
		}
	}

	const jumpToEnd = () => {
		const s = $()
		if (s.attrNavActive) {
			const count = attrCountForSelectedSpan()
			setSelectedAttrIndex(Math.max(0, count - 1))
			return
		}
		if (s.spanNavActive && s.selectedTrace) {
			const visibleCount = getVisibleSpans(s.selectedTrace.spans, s.collapsedSpanIds).length
			setSelectedSpanIndex(visibleCount === 0 ? null : visibleCount - 1)
		} else {
			selectFilteredTraceAt(s.filteredTraces.length - 1)
		}
	}

	const moveTraceBy = (direction: -1 | 1) => {
		const s = $()
		const filtered = s.filteredTraces
		if (filtered.length === 0) return
		setSelectedTraceIndex((current) => {
			const currentTraceId = s.traceState.data[current]?.traceId
			const currentFilteredIdx = currentTraceId
				? filtered.findIndex((t) => t.traceId === currentTraceId)
				: -1
			if (currentFilteredIdx < 0) {
				const fallbackTrace = filtered[0]
				if (!fallbackTrace) return current
				const fallbackIndex = s.traceState.data.findIndex((t) => t.traceId === fallbackTrace.traceId)
				return fallbackIndex >= 0 ? fallbackIndex : current
			}
			const nextFilteredIdx = Math.max(0, Math.min(currentFilteredIdx + direction, filtered.length - 1))
			const nextTrace = filtered[nextFilteredIdx]
			if (!nextTrace) return current
			const fullIndex = s.traceState.data.findIndex((t) => t.traceId === nextTrace.traceId)
			return fullIndex >= 0 ? fullIndex : current
		})
	}

	const moveServiceLogBy = (direction: -1 | 1) => {
		const s = $()
		setSelectedServiceLogIndex((current) => {
			if (s.serviceLogState.data.length === 0) return 0
			return Math.max(0, Math.min(current + direction, s.serviceLogState.data.length - 1))
		})
	}

	const cycleService = (direction: -1 | 1) => {
		const s = $()
		if (s.traceState.services.length === 0) return
		const currentIndex = s.selectedTraceService ? s.traceState.services.indexOf(s.selectedTraceService) : -1
		const nextIndex = currentIndex >= 0 ? (currentIndex + direction + s.traceState.services.length) % s.traceState.services.length : 0
		setSelectedTraceService(s.traceState.services[nextIndex] ?? s.selectedTraceService)
	}

	const refresh = (message?: string) => {
		const s = $()
		setRefreshNonce((current) => current + 1)
		if (message) s.flashNotice(message)
	}

	const copySelectedAttrValue = () => {
		const s = $()
		if (!s.selectedTrace || s.selectedSpanIndex === null) return
		const visible = getVisibleSpans(s.selectedTrace.spans, s.collapsedSpanIds)
		const span = visible[s.selectedSpanIndex]
		if (!span) return
		const entries = Object.entries(span.tags)
		const entry = entries[s.selectedAttrIndex] ?? entries[0]
		if (!entry) {
			s.flashNotice("No tag to copy")
			return
		}
		const [key, value] = entry
		void copyToClipboard(value)
			.then(() => {
				const preview = value.length > 40 ? `${value.slice(0, 39)}\u2026` : value
				s.flashNotice(`Copied ${key}: ${preview}`)
			})
			.catch((error) => {
				s.flashNotice(error instanceof Error ? error.message : String(error))
			})
	}

	const copySelectedIds = () => {
		const s = $()
		if (s.serviceLogNavActive) {
			const selectedLog = s.serviceLogState.data[s.selectedServiceLogIndex]
			if (!selectedLog?.traceId) {
				s.flashNotice("No trace id to copy")
				return
			}
			const lines = [
				`traceId=${selectedLog.traceId}`,
				selectedLog.spanId ? `spanId=${selectedLog.spanId}` : null,
			].filter((line): line is string => line !== null).join("\n")
			void copyToClipboard(lines)
				.then(() => {
					s.flashNotice(selectedLog.spanId ? "Copied trace and span ids" : "Copied trace id")
				})
				.catch((error) => {
					s.flashNotice(error instanceof Error ? error.message : String(error))
				})
			return
		}

		if (!s.selectedTrace) {
			s.flashNotice("No trace selected")
			return
		}

		const visibleSpans = getVisibleSpans(s.selectedTrace.spans, s.collapsedSpanIds)
		const selectedSpan = s.selectedSpanIndex !== null ? visibleSpans[s.selectedSpanIndex] ?? null : null
		const lines = [
			`traceId=${s.selectedTrace.traceId}`,
			selectedSpan ? `spanId=${selectedSpan.spanId}` : null,
		].filter((line): line is string => line !== null).join("\n")

		void copyToClipboard(lines)
			.then(() => {
				s.flashNotice(selectedSpan ? "Copied trace and span ids" : "Copied trace id")
			})
			.catch((error) => {
				s.flashNotice(error instanceof Error ? error.message : String(error))
			})
	}

	const toggleServiceLogsView = () => {
		const s = $()
		if (!s.selectedTraceService && !s.selectedTrace) return
		setDetailView((current) => current === "service-logs" ? (s.selectedSpanIndex !== null ? "span-detail" : "waterfall") : "service-logs")
	}

	const pageBy = (direction: -1 | 1) => {
		const s = $()
		if (s.attrNavActive) {
			const count = attrCountForSelectedSpan()
			if (count === 0) return
			// Attr page size: ~half the viewport in "blocks", not rows.
			// Attributes are variable height so measuring in blocks keeps
			// the jump feeling consistent regardless of value length.
			const pageSize = Math.max(1, Math.floor((s.isWideLayout ? s.wideBodyLines : s.narrowBodyLines) / 4))
			setSelectedAttrIndex((current) =>
				Math.max(0, Math.min(current + direction * pageSize, count - 1)),
			)
			return
		}
		if (s.serviceLogNavActive) {
			const serviceLogPageSize = Math.max(1, Math.floor((s.isWideLayout ? s.wideBodyLines : s.narrowBodyLines) * 0.5))
			setSelectedServiceLogIndex((current) => {
				if (s.serviceLogState.data.length === 0) return 0
				return Math.max(0, Math.min(current + direction * serviceLogPageSize, s.serviceLogState.data.length - 1))
			})
		} else if (s.spanNavActive) {
			if (!s.selectedTrace) return
			const visibleCount = getVisibleSpans(s.selectedTrace.spans, s.collapsedSpanIds).length
			setSelectedSpanIndex((current) => {
				if (visibleCount === 0) return null
				const start = current ?? 0
				return Math.max(0, Math.min(start + direction * s.spanPageSize, visibleCount - 1))
			})
		} else {
			const filtered = s.filteredTraces
			if (filtered.length === 0) return
			setSelectedTraceIndex((current) => {
				const currentTraceId = s.traceState.data[current]?.traceId
				const currentFilteredIdx = currentTraceId
					? filtered.findIndex((t) => t.traceId === currentTraceId)
					: 0
				const nextIdx = Math.max(0, Math.min(currentFilteredIdx + direction * s.tracePageSize, filtered.length - 1))
				const nextTrace = filtered[nextIdx]
				if (!nextTrace) return current
				const fullIndex = s.traceState.data.findIndex((t) => t.traceId === nextTrace.traceId)
				return fullIndex >= 0 ? fullIndex : current
			})
		}
	}

	useKeyboard((key) => {
		const s = $()

		// Attribute picker modal owns the keyboard while open.
		if (s.pickerMode !== "off") {
			const rows = filterFacets(s.attrFacets.data, s.pickerInput)
			const clampedIndex = rows.length === 0 ? 0 : Math.max(0, Math.min(s.pickerIndex, rows.length - 1))
			const move = (delta: number) => {
				if (rows.length === 0) return
				setPickerIndex(Math.max(0, Math.min(clampedIndex + delta, rows.length - 1)))
			}
			if (key.name === "escape") {
				setPickerMode("off")
				setPickerInput("")
				setPickerIndex(0)
				return
			}
			// Ctrl-C: clear input, or close the picker if already empty.
			if (key.ctrl && key.name === "c") {
				if (s.pickerInput.length > 0) {
					setPickerInput("")
					setPickerIndex(0)
				} else {
					setPickerMode("off")
					setPickerIndex(0)
				}
				return
			}
			if (key.name === "up" || (key.ctrl && key.name === "p")) { move(-1); return }
			if (key.name === "down" || (key.ctrl && key.name === "n")) { move(1); return }
			if (key.name === "pageup") { move(-10); return }
			if (key.name === "pagedown") { move(10); return }
			if (key.name === "return" || key.name === "enter") {
				const row = rows[clampedIndex]
				if (!row) return
				if (s.pickerMode === "keys") {
					// Drill from keys → values for this key.
					setActiveAttrKey(row.value)
					setPickerMode("values")
					setPickerInput("")
					setPickerIndex(0)
				} else {
					// Apply: activeAttrKey is already set, now pin the value.
					setActiveAttrValue(row.value)
					setPickerMode("off")
					setPickerInput("")
					setPickerIndex(0)
					s.flashNotice(`Filter: ${s.activeAttrKey}=${row.value}`)
				}
				return
			}
			if (key.name === "backspace") {
				if (s.pickerInput.length > 0) {
					setPickerInput(s.pickerInput.slice(0, -1))
					setPickerIndex(0)
					return
				}
				// At empty input in values mode, backspace walks back to keys.
				if (s.pickerMode === "values") {
					setPickerMode("keys")
					setActiveAttrKey(null)
					setPickerIndex(0)
					return
				}
				return
			}
			// Prefer key.sequence over key.name so multi-char paste events that
			// slip through as a single raw sequence still get inserted in full.
			const printable = extractPrintable(key)
			if (printable) {
				// Functional setState — multiple key events in the same tick would
				// otherwise all read a stale stateRef.current.pickerInput and
				// clobber each other, losing all but the last char of a paste.
				setPickerInput((current) => current + printable)
				setPickerIndex(0)
				return
			}
			return
		}

		// Filter mode: capture text input
		if (s.filterMode) {
			if (key.name === "escape") {
				setFilterMode(false)
				setFilterText("")
				return
			}
			// Ctrl-C: clear the input, or exit filter mode if already empty.
			if (key.ctrl && key.name === "c") {
				if (s.filterText.length > 0) {
					setFilterText("")
				} else {
					setFilterMode(false)
				}
				return
			}
			if (key.name === "return" || key.name === "enter") {
				setFilterMode(false)
				return
			}
			if (key.name === "backspace") {
				setFilterText((current) => current.slice(0, -1))
				return
			}
			const printable = extractPrintable(key)
			if (printable) {
				// Functional setState so rapid keystrokes / pastes don't clobber
				// each other via a stale stateRef.current.filterText closure.
				setFilterText((current) => current + printable)
				return
			}
			return
		}

		// Waterfall filter mode: text-capture scoped to the current
		// trace's spans.
		// - enter  → commit: close input but keep text so dimming persists
		//            while the user navigates. `/` can be pressed again
		//            to edit.
		// - esc    → cancel: clear text + exit input entirely.
		// - ctrl-c → clear input if non-empty, otherwise exit.
		if (s.waterfallFilterMode) {
			if (key.name === "escape") {
				setWaterfallFilterMode(false)
				setWaterfallFilterText("")
				return
			}
			if (key.ctrl && key.name === "c") {
				if (s.waterfallFilterText.length > 0) {
					setWaterfallFilterText("")
				} else {
					setWaterfallFilterMode(false)
				}
				return
			}
			if (key.name === "return" || key.name === "enter") {
				setWaterfallFilterMode(false)
				return
			}
			if (key.name === "backspace") {
				setWaterfallFilterText((current) => current.slice(0, -1))
				return
			}
			const printable = extractPrintable(key)
			if (printable) {
				setWaterfallFilterText((current) => current + printable)
				return
			}
			return
		}
		const plainG = key.name === "g" && !key.ctrl && !key.meta && !key.option && !key.shift
		const shiftedG = key.name === "g" && key.shift
		const questionMark = key.name === "?" || (key.name === "/" && key.shift)

		if (questionMark) {
			clearPendingG()
			setShowHelp((current) => !current)
			return
		}

		if (s.showHelp) {
			if (key.name === "return" || key.name === "enter" || key.name === "escape") {
				setShowHelp(false)
			}
			return
		}

		if (plainG && !key.repeated) {
			if (pendingGRef.current) {
				clearPendingG()
				jumpToStart()
			} else {
				armPendingG()
			}
			return
		}

		if (shiftedG) {
			clearPendingG()
			jumpToEnd()
			return
		}

		clearPendingG()

		if (key.name === "q" || (key.ctrl && key.name === "c")) {
			if (quittingRef.current) return
			quittingRef.current = true
			renderer.destroy()
			return
		}
		if (key.name === "home") {
			if (s.serviceLogNavActive) {
				setSelectedServiceLogIndex(0)
			} else {
				jumpToStart()
			}
			return
		}
		if (key.name === "end") {
			if (s.serviceLogNavActive) {
				setSelectedServiceLogIndex(s.serviceLogState.data.length === 0 ? 0 : s.serviceLogState.data.length - 1)
			} else {
				jumpToEnd()
			}
			return
		}
		if (key.name === "pagedown" || (key.ctrl && key.name === "d")) {
			pageBy(1)
			return
		}
		if (key.name === "pageup" || (key.ctrl && key.name === "u")) {
			pageBy(-1)
			return
		}
		if (key.ctrl && key.name === "p") {
			moveTraceBy(-1)
			return
		}
		if (key.ctrl && key.name === "n") {
			moveTraceBy(1)
			return
		}
		if (key.name === "escape") {
			if (s.showHelp) {
				setShowHelp(false)
				return
			}
			// Committed waterfall filter outranks drill-back: hitting esc
			// should clear the dim before jumping you out of the span
			// detail pane. That keeps a single `esc` predictable whether
			// the filter was applied by typing or left over from before.
			if (s.waterfallFilterText.length > 0) {
				setWaterfallFilterText("")
				return
			}
			if (s.detailView === "span-detail" || s.detailView === "service-logs") {
				setDetailView("waterfall")
				return
			}
			if (s.spanNavActive) {
				setSelectedSpanIndex(null)
				return
			}
			// At the trace list, `esc` clears any applied attribute filter so
			// there's a clean way back to the unfiltered list without hunting
			// for the picker key.
			if (s.activeAttrKey || s.activeAttrValue) {
				setActiveAttrKey(null)
				setActiveAttrValue(null)
				s.flashNotice("Cleared attribute filter")
				return
			}
			return
		}
		if (key.name === "return" || key.name === "enter") {
			if (s.detailView === "service-logs") {
				const selectedLog = s.serviceLogState.data[s.selectedServiceLogIndex]
				if (selectedLog?.traceId) {
					const traceIndex = s.traceState.data.findIndex((trace) => trace.traceId === selectedLog.traceId)
					if (traceIndex >= 0) {
						setSelectedTraceIndex(traceIndex)
						setDetailView("waterfall")
						s.flashNotice(`Jumped to trace ${selectedLog.traceId.slice(-8)}`)
					}
				}
				return
			}
			if (s.spanNavActive && s.detailView === "waterfall") {
				setDetailView("span-detail")
				return
			}
			if (!s.spanNavActive && s.selectedTrace && s.selectedTrace.spans.length > 0) {
				setSelectedSpanIndex(0)
				return
			}
			return
		}
		if (key.name === "r") {
			refresh("Refreshing traces...")
			return
		}
		if (key.name === "a") {
			setAutoRefresh(!s.autoRefresh)
			s.flashNotice(s.autoRefresh ? "Auto-refresh paused" : "Auto-refresh resumed")
			return
		}
		if (key.name === "s") {
			const modes: readonly TraceSortMode[] = ["recent", "slowest", "errors"]
			const nextMode = modes[(modes.indexOf(s.traceSort) + 1) % modes.length] ?? "recent"
			setTraceSort(nextMode)
			s.flashNotice(`Sort: ${nextMode}`)
			return
		}
		if (key.name === "t") {
			const nextTheme = cycleThemeName(s.selectedTheme)
			setSelectedTheme(nextTheme)
			s.flashNotice(`Theme: ${themeLabel(nextTheme)}`)
			return
		}
		// `n` / `N`: jump between matches of the committed waterfall filter.
		// Only active when drilled into a trace AND the filter has text
		// (committed or live — either way, there's a dim/highlight we can
		// step through). Wraps at the ends like vim's /n. Plain `n` forward,
		// shift-n (`N`) backward.
		if ((key.name === "n" || key.name === "N") && !key.ctrl && !key.meta) {
			const inWaterfall = s.detailView === "span-detail" || s.selectedSpanIndex !== null
			if (inWaterfall && s.waterfallFilterText.length > 0 && s.selectedTrace) {
				const visibleSpans = getVisibleSpans(s.selectedTrace.spans, s.collapsedSpanIds)
				const matchingIds = computeMatchingSpanIds(visibleSpans, s.waterfallFilterText)
				if (matchingIds && matchingIds.size > 0) {
					const direction = key.name === "N" ? -1 : 1
					const next = findAdjacentMatch(visibleSpans, matchingIds, s.selectedSpanIndex, direction)
					if (next !== null) setSelectedSpanIndex(next)
					else s.flashNotice("No matches")
				} else {
					s.flashNotice("No matches")
				}
				return
			}
			// Fall through when not in a trace detail view — reserves `n`
			// for other future bindings without shadowing them globally.
		}

		if (key.name === "/" && !key.shift) {
			// When drilled into a trace (viewLevel >= 1 — waterfall or
			// span detail is the dominant pane), `/` opens a filter scoped
			// to the current trace's spans instead of the trace list.
			// Drill level here is inferred from selectedSpanIndex/detailView
			// the same way useAppLayout does it.
			const inWaterfall = s.detailView === "span-detail" || s.selectedSpanIndex !== null
			if (inWaterfall) {
				setWaterfallFilterMode(true)
			} else {
				setFilterMode(true)
			}
			return
		}
		if ((key.name === "f" || key.name === "F") && !key.ctrl && !key.meta) {
			// Open attribute picker at the keys step. If a filter is already
			// applied, reopening lets the user refine or switch.
			setPickerMode("keys")
			setPickerInput("")
			setPickerIndex(0)
			setActiveAttrKey(null)
			return
		}
		if (key.name === "tab") {
			toggleServiceLogsView()
			return
		}
		if (key.name === "[") {
			cycleService(-1)
			return
		}
		if (key.name === "]") {
			cycleService(1)
			return
		}
		if (key.name === "up" || key.name === "k") {
			if (s.attrNavActive) {
				setSelectedAttrIndex((current) => Math.max(0, current - 1))
				return
			}
			if (s.serviceLogNavActive) {
				moveServiceLogBy(-1)
			} else if (s.spanNavActive) {
				// Locked to span nav; never fall through to trace-list nav while
				// drilled in. If the trace detail is still loading, swallow the
				// key instead of silently leaking it to the trace list.
				if (s.selectedTrace) {
					const visibleCount = getVisibleSpans(s.selectedTrace.spans, s.collapsedSpanIds).length
					setSelectedSpanIndex((current) => {
						if (current === null || visibleCount === 0) return 0
						return Math.max(0, current - 1)
					})
				}
			} else {
				moveTraceBy(-1)
			}
			return
		}
		if (key.name === "down" || key.name === "j") {
			if (s.attrNavActive) {
				const count = attrCountForSelectedSpan()
				if (count === 0) return
				setSelectedAttrIndex((current) => Math.min(current + 1, count - 1))
				return
			}
			if (s.serviceLogNavActive) {
				moveServiceLogBy(1)
			} else if (s.spanNavActive) {
				if (s.selectedTrace) {
					const visibleCount = getVisibleSpans(s.selectedTrace.spans, s.collapsedSpanIds).length
					setSelectedSpanIndex((current) => {
						if (current === null || visibleCount === 0) return 0
						return Math.min(current + 1, visibleCount - 1)
					})
				}
			} else {
				moveTraceBy(1)
			}
			return
		}
		if (key.name === "left" || key.name === "h") {
			if (s.spanNavActive && s.selectedTrace) {
				const trace = s.selectedTrace
				setCollapsedSpanIds((currentCollapsed) => {
					const result = resolveCollapseStep({
						spans: trace.spans,
						collapsed: currentCollapsed,
						selectedIndex: s.selectedSpanIndex,
						direction: "left",
					})
					if (result.selectedIndex !== s.selectedSpanIndex) {
						setSelectedSpanIndex(result.selectedIndex)
					}
					return result.collapsed
				})
			}
			return
		}
		if (key.name === "right" || key.name === "l") {
			if (s.spanNavActive && s.selectedTrace) {
				const trace = s.selectedTrace
				setCollapsedSpanIds((currentCollapsed) => {
					const result = resolveCollapseStep({
						spans: trace.spans,
						collapsed: currentCollapsed,
						selectedIndex: s.selectedSpanIndex,
						direction: "right",
					})
					if (result.selectedIndex !== s.selectedSpanIndex) {
						setSelectedSpanIndex(result.selectedIndex)
					}
					return result.collapsed
				})
			} else if (!s.spanNavActive && !s.serviceLogNavActive) {
				toggleServiceLogsView()
			}
			return
		}
		if (key.name === "o" && !key.shift) {
			if (s.serviceLogNavActive) {
				const selectedLog = s.serviceLogState.data[s.selectedServiceLogIndex]
				if (selectedLog?.traceId) {
					void Bun.spawn({ cmd: ["open", traceUiUrl(selectedLog.traceId)], stdout: "ignore", stderr: "ignore" })
					s.flashNotice(`Opened trace ${selectedLog.traceId.slice(-8)}`)
				}
				return
			}
			if (!s.selectedTrace) return
			void Bun.spawn({ cmd: ["open", traceUiUrl(s.selectedTrace.traceId)], stdout: "ignore", stderr: "ignore" })
			s.flashNotice(`Opened trace ${s.selectedTrace.traceId.slice(-8)}`)
			return
		}
		if (key.name === "o" && key.shift) {
			void Bun.spawn({ cmd: ["open", webUiUrl()], stdout: "ignore", stderr: "ignore" })
			s.flashNotice("Opened web UI")
			return
		}
		if (key.name === "y" || key.name === "Y") {
			// In the full-screen span content view, `y` copies the
			// selected attribute's value (useful for grabbing a prompt or
			// response chunk). Everywhere else it falls back to the
			// existing "copy trace/span id" behaviour.
			if (s.attrNavActive) {
				copySelectedAttrValue()
			} else {
				copySelectedIds()
			}
			return
		}
		if (key.name === "c" || key.name === "C") {
			void copyToClipboard(otelServerInstructions())
				.then(() => {
					s.flashNotice("Copied OTEL server details")
				})
				.catch((error) => {
					s.flashNotice(error instanceof Error ? error.message : String(error))
				})
		}
	})

	return { spanNavActive }
}
