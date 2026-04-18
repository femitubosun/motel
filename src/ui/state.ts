import { Effect } from "effect"
import * as Atom from "effect/unstable/reactivity/Atom"
import { readFileSync } from "node:fs"
import { dirname } from "node:path"
import { config } from "../config.ts"
import type { LogItem, TraceItem, TraceSummaryItem } from "../domain.ts"
import { queryRuntime } from "../runtime.ts"
import { LogQueryService } from "../services/LogQueryService.ts"
import { TraceQueryService } from "../services/TraceQueryService.ts"
import type { ThemeName } from "./theme.ts"

export type LoadStatus = "loading" | "ready" | "error"
export type DetailView = "waterfall" | "span-detail" | "service-logs"

export interface TraceState {
	readonly status: LoadStatus
	readonly services: readonly string[]
	readonly data: readonly TraceSummaryItem[]
	readonly error: string | null
	readonly fetchedAt: Date | null
}

export interface TraceDetailState {
	readonly status: LoadStatus
	readonly traceId: string | null
	readonly data: TraceItem | null
	readonly error: string | null
	readonly fetchedAt: Date | null
}

export interface LogState {
	readonly status: LoadStatus
	readonly traceId: string | null
	readonly data: readonly LogItem[]
	readonly error: string | null
	readonly fetchedAt: Date | null
}

export interface ServiceLogState {
	readonly status: LoadStatus
	readonly serviceName: string | null
	readonly data: readonly LogItem[]
	readonly error: string | null
	readonly fetchedAt: Date | null
}

export const initialTraceState: TraceState = {
	status: "loading",
	services: [],
	data: [],
	error: null,
	fetchedAt: null,
}

export const initialLogState: LogState = {
	status: "ready",
	traceId: null,
	data: [],
	error: null,
	fetchedAt: null,
}

export const initialTraceDetailState: TraceDetailState = {
	status: "ready",
	traceId: null,
	data: null,
	error: null,
	fetchedAt: null,
}

export const initialServiceLogState: ServiceLogState = {
	status: "ready",
	serviceName: null,
	data: [],
	error: null,
	fetchedAt: null,
}

export const traceStateAtom = Atom.make(initialTraceState).pipe(Atom.keepAlive)
export const traceDetailStateAtom = Atom.make(initialTraceDetailState).pipe(Atom.keepAlive)
export const logStateAtom = Atom.make(initialLogState).pipe(Atom.keepAlive)
export const serviceLogStateAtom = Atom.make(initialServiceLogState).pipe(Atom.keepAlive)
export const selectedServiceLogIndexAtom = Atom.make(0).pipe(Atom.keepAlive)
export const selectedTraceIndexAtom = Atom.make(0).pipe(Atom.keepAlive)
const lastServicePath = `${dirname(config.otel.databasePath)}/last-service.txt`
const readLastService = (): string | null => {
	try { return readFileSync(lastServicePath, "utf-8").trim() || null }
	catch { return null }
}

let lastPersistedService = readLastService()

export const persistSelectedService = (service: string) => {
	if (service === lastPersistedService) return
	lastPersistedService = service
	Bun.write(lastServicePath, service).catch(() => {})
}

export const selectedTraceServiceAtom = Atom.make<string | null>(readLastService() ?? config.otel.serviceName).pipe(Atom.keepAlive)
export const refreshNonceAtom = Atom.make(0).pipe(Atom.keepAlive)
export const noticeAtom = Atom.make<string | null>(null).pipe(Atom.keepAlive)
export const selectedSpanIndexAtom = Atom.make<number | null>(null).pipe(Atom.keepAlive)
// Cursor inside the full-screen span content view (detailView === "span-detail").
// Tracks which span tag is currently selected for copy / drill-in. Reset to 0
// on each new span so the cursor doesn't point past a shorter tag list.
export const selectedAttrIndexAtom = Atom.make(0).pipe(Atom.keepAlive)
export const detailViewAtom = Atom.make<DetailView>("waterfall").pipe(Atom.keepAlive)
export const showHelpAtom = Atom.make(false).pipe(Atom.keepAlive)
export const autoRefreshAtom = Atom.make(false).pipe(Atom.keepAlive)
export const filterModeAtom = Atom.make(false).pipe(Atom.keepAlive)
export const filterTextAtom = Atom.make("").pipe(Atom.keepAlive)

// Waterfall-scoped filter: the `/` key while drilled into a trace
// (viewLevel >= 1) opens this filter instead of the trace-list one.
// Purely client-side — dims spans whose operation name and attribute
// values don't contain the needle.
export const waterfallFilterModeAtom = Atom.make(false).pipe(Atom.keepAlive)
export const waterfallFilterTextAtom = Atom.make("").pipe(Atom.keepAlive)

// Attribute filter (F key): pick a span-attribute key + exact value to restrict the trace list.
export type AttrPickerMode = "off" | "keys" | "values"
export const attrPickerModeAtom = Atom.make<AttrPickerMode>("off").pipe(Atom.keepAlive)
export const attrPickerInputAtom = Atom.make("").pipe(Atom.keepAlive)
export const attrPickerIndexAtom = Atom.make(0).pipe(Atom.keepAlive)

export interface AttrFacetState {
	readonly status: LoadStatus
	readonly key: string | null // null when loading keys; set when loading values
	readonly data: readonly { readonly value: string; readonly count: number }[]
	readonly error: string | null
}

export const initialAttrFacetState: AttrFacetState = {
	status: "ready",
	key: null,
	data: [],
	error: null,
}

export const attrFacetStateAtom = Atom.make(initialAttrFacetState).pipe(Atom.keepAlive)

// Applied filter (drives trace list query)
export const activeAttrKeyAtom = Atom.make<string | null>(null).pipe(Atom.keepAlive)
export const activeAttrValueAtom = Atom.make<string | null>(null).pipe(Atom.keepAlive)

const lastThemePath = `${dirname(config.otel.databasePath)}/last-theme.txt`
const readLastTheme = (): ThemeName => {
	try {
		const raw = readFileSync(lastThemePath, "utf-8").trim()
		return raw === "tokyo-night" || raw === "catppuccin" || raw === "motel-default" ? raw : "motel-default"
	} catch {
		return "motel-default"
	}
}

let lastPersistedTheme = readLastTheme()

export const persistSelectedTheme = (theme: ThemeName) => {
	if (theme === lastPersistedTheme) return
	lastPersistedTheme = theme
	Bun.write(lastThemePath, theme).catch(() => {})
}

export const selectedThemeAtom = Atom.make<ThemeName>(readLastTheme()).pipe(Atom.keepAlive)

export type TraceSortMode = "recent" | "slowest" | "errors"
export const traceSortAtom = Atom.make<TraceSortMode>("recent").pipe(Atom.keepAlive)
export const collapsedSpanIdsAtom = Atom.make(new Set<string>() as ReadonlySet<string>).pipe(Atom.keepAlive)

export const loadTraceServices = () => queryRuntime.runPromise(Effect.flatMap(TraceQueryService.asEffect(), (service) => service.listServices))
export const loadRecentTraceSummaries = (serviceName: string) => queryRuntime.runPromise(Effect.flatMap(TraceQueryService.asEffect(), (service) => service.listTraceSummaries(serviceName)))
/**
 * Server-side trace summary search. Accepts any combination of:
 *
 * - `attributeFilters` — exact-match span attributes (from the `f` picker)
 * - `aiText`           — FTS5-backed search across LLM prompt/response
 *                        content (AI_FTS_KEYS), from the `:ai <query>`
 *                        modifier in the `/` filter
 *
 * Both filters compose: when both are set, a trace must match both. When
 * neither is set, callers should prefer `loadRecentTraceSummaries` so
 * the server can skip the search path entirely.
 */
export const loadFilteredTraceSummaries = (
	serviceName: string,
	options: {
		readonly attributeFilters?: Readonly<Record<string, string>>
		readonly aiText?: string | null
	},
) =>
	queryRuntime.runPromise(Effect.flatMap(TraceQueryService.asEffect(), (service) => service.searchTraceSummaries({
		serviceName,
		attributeFilters: options.attributeFilters,
		aiText: options.aiText ?? null,
		limit: config.otel.traceFetchLimit,
	})))
export const loadTraceAttributeKeys = (serviceName: string) =>
	queryRuntime.runPromise(Effect.flatMap(TraceQueryService.asEffect(), (service) => service.listFacets({ type: "traces", field: "attribute_keys", serviceName, limit: 200 })))
export const loadTraceAttributeValues = (serviceName: string, key: string) =>
	queryRuntime.runPromise(Effect.flatMap(TraceQueryService.asEffect(), (service) => service.listFacets({ type: "traces", field: "attribute_values", serviceName, key, limit: 200 })))
export const loadTraceDetail = (traceId: string) => queryRuntime.runPromise(Effect.flatMap(TraceQueryService.asEffect(), (service) => service.getTrace(traceId)))
export const loadTraceLogs = (traceId: string) => queryRuntime.runPromise(Effect.flatMap(LogQueryService.asEffect(), (service) => service.listTraceLogs(traceId)))
export const loadServiceLogs = (serviceName: string) => queryRuntime.runPromise(Effect.flatMap(LogQueryService.asEffect(), (service) => service.listRecentLogs(serviceName)))
