import { useAtom } from "@effect/atom-react"
import { useEffect } from "react"
import {
	attrFacetStateAtom,
	attrPickerModeAtom,
	initialAttrFacetState,
	loadTraceAttributeKeys,
	loadTraceAttributeValues,
	selectedTraceServiceAtom,
} from "./state.ts"

// When the picker is open, load the current facet page (keys, or values for
// a specific key) and keep it in sync with the selected service. We key the
// effect off picker mode + service + target key so refetches happen on drill
// in/out and when the user switches services mid-pick.
export const useAttrFilterPicker = (selectedKey: string | null) => {
	const [pickerMode] = useAtom(attrPickerModeAtom)
	const [service] = useAtom(selectedTraceServiceAtom)
	const [, setFacetState] = useAtom(attrFacetStateAtom)

	useEffect(() => {
		if (pickerMode === "off" || !service) {
			setFacetState(initialAttrFacetState)
			return
		}
		let cancelled = false
		setFacetState({ status: "loading", key: pickerMode === "values" ? selectedKey : null, data: [], error: null })
		const load = async () => {
			try {
				const rows = pickerMode === "keys"
					? await loadTraceAttributeKeys(service)
					: selectedKey
						? await loadTraceAttributeValues(service, selectedKey)
						: []
				if (cancelled) return
				setFacetState({ status: "ready", key: pickerMode === "values" ? selectedKey : null, data: rows, error: null })
			} catch (err) {
				if (cancelled) return
				setFacetState({ status: "error", key: pickerMode === "values" ? selectedKey : null, data: [], error: err instanceof Error ? err.message : String(err) })
			}
		}
		void load()
		return () => {
			cancelled = true
		}
	}, [pickerMode, service, selectedKey, setFacetState])
}
