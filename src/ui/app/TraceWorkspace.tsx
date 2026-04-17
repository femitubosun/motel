import type { ScrollBoxRenderable } from "@opentui/core"
import type { RefObject } from "react"
import type { LogItem, TraceItem, TraceSummaryItem } from "../../domain.ts"
import { formatShortDate, formatTimestamp } from "../format.ts"
import { AlignedHeaderLine, BlankRow, Divider, SeparatorColumn, TextLine } from "../primitives.tsx"
import { ServiceLogsView } from "../ServiceLogs.tsx"
import { SpanDetailPane } from "../SpanDetailPane.tsx"
import type { DetailView, LogState, ServiceLogState, TraceDetailState } from "../state.ts"
import { colors, SEPARATOR } from "../theme.ts"
import { TraceDetailsPane } from "../TraceDetailsPane.tsx"
import type { TraceListProps } from "../TraceList.tsx"
import { TraceListPane } from "./TraceListPane.tsx"
import type { AppLayout } from "./useAppLayout.ts"

const separatorJunctionChars = new Map<number, string>([[3, "├"]])
const separatorCrossChars = new Map<number, string>([[3, "┼"]])

interface TraceWorkspaceProps {
	readonly layout: AppLayout
	readonly detailView: DetailView
	readonly filterMode: boolean
	readonly filterText: string
	readonly traceListProps: TraceListProps
	readonly traceListScrollRef: RefObject<ScrollBoxRenderable | null>
	readonly selectedTraceService: string | null
	readonly serviceLogState: ServiceLogState
	readonly selectedServiceLogIndex: number
	readonly setSelectedServiceLogIndex: (value: number | ((current: number) => number)) => void
	readonly traceDetailState: TraceDetailState
	readonly selectedTrace: TraceItem | null
	readonly selectedTraceSummary: TraceSummaryItem | null
	readonly logState: LogState
	readonly selectedSpanIndex: number | null
	readonly collapsedSpanIds: ReadonlySet<string>
	readonly viewLevel: 0 | 1 | 2
	readonly selectedSpan: TraceItem["spans"][number] | null
	readonly selectedSpanLogs: readonly LogItem[]
	readonly selectSpan: (index: number) => void
}

export const TraceWorkspace = ({
	layout,
	detailView,
	filterMode,
	filterText,
	traceListProps,
	traceListScrollRef,
	selectedTraceService,
	serviceLogState,
	selectedServiceLogIndex,
	setSelectedServiceLogIndex,
	traceDetailState,
	selectedTrace,
	selectedTraceSummary,
	logState,
	selectedSpanIndex,
	collapsedSpanIds,
	viewLevel,
	selectedSpan,
	selectedSpanLogs,
	selectSpan,
}: TraceWorkspaceProps) => {
	const {
		contentWidth,
		headerFooterWidth,
		isWideLayout,
		leftPaneWidth,
		rightPaneWidth,
		leftContentWidth,
		rightContentWidth,
		sectionPadding,
		wideBodyHeight,
		wideBodyLines,
		narrowListHeight,
		narrowBodyLines,
		narrowFullBodyLines,
		wideTraceListBodyHeight,
		narrowTraceListBodyHeight,
		availableContentHeight,
	} = layout

	if (detailView === "service-logs") {
		return (
			<box flexGrow={1} flexDirection="column" paddingLeft={1} paddingRight={1}>
				<AlignedHeaderLine
					left="SERVICE LOGS"
					right={`${serviceLogState.data.length} logs${serviceLogState.fetchedAt ? `${SEPARATOR}${formatShortDate(serviceLogState.fetchedAt)} ${formatTimestamp(serviceLogState.fetchedAt)}` : ""}`}
					width={headerFooterWidth}
					rightFg={colors.count}
				/>
				<TextLine>
					<span fg={colors.defaultService}>{selectedTraceService ?? "unknown"}</span>
					<span fg={colors.separator}>{SEPARATOR}</span>
					<span fg={colors.count}>recent logs</span>
				</TextLine>
				<BlankRow />
				<ServiceLogsView
					serviceName={selectedTraceService}
					logsState={serviceLogState}
					selectedIndex={selectedServiceLogIndex}
					onSelectLog={setSelectedServiceLogIndex}
					contentWidth={headerFooterWidth}
					bodyLines={Math.max(8, availableContentHeight - 3)}
				/>
			</box>
		)
	}

	if (isWideLayout) {
		return (
			<box flexGrow={1} flexDirection="row">
				<box width={leftPaneWidth} height={wideBodyHeight} flexDirection="column">
					{viewLevel <= 1 ? (
						<TraceListPane
							traceListProps={traceListProps}
							filterMode={filterMode}
							filterText={filterText}
							filterWidth={leftContentWidth}
							containerHeight={wideBodyHeight}
							bodyHeight={wideTraceListBodyHeight}
							padding={sectionPadding}
							scrollRef={traceListScrollRef}
						/>
					) : (
						<TraceDetailsPane
							trace={selectedTrace}
							traceSummary={selectedTraceSummary}
							traceStatus={traceDetailState.status}
							traceError={traceDetailState.error}
							traceLogsState={logState}
							contentWidth={leftContentWidth}
							bodyLines={wideBodyLines}
							paneWidth={leftPaneWidth}
							selectedSpanIndex={selectedSpanIndex}
							collapsedSpanIds={collapsedSpanIds}
							focused={false}
							onSelectSpan={selectSpan}
						/>
					)}
				</box>
				<SeparatorColumn height={wideBodyHeight} junctionChars={viewLevel === 2 ? separatorCrossChars : separatorJunctionChars} />
				<box width={rightPaneWidth} height={wideBodyHeight} flexDirection="column">
					{viewLevel <= 1 ? (
						<TraceDetailsPane
							trace={selectedTrace}
							traceSummary={selectedTraceSummary}
							traceStatus={traceDetailState.status}
							traceError={traceDetailState.error}
							traceLogsState={logState}
							contentWidth={rightContentWidth}
							bodyLines={wideBodyLines}
							paneWidth={rightPaneWidth}
							selectedSpanIndex={selectedSpanIndex}
							collapsedSpanIds={collapsedSpanIds}
							focused={viewLevel === 1}
							onSelectSpan={selectSpan}
						/>
					) : (
						<SpanDetailPane
							span={selectedSpan}
							trace={selectedTrace}
							logs={selectedSpanLogs}
							contentWidth={rightContentWidth}
							bodyLines={wideBodyLines}
							paneWidth={rightPaneWidth}
							focused={true}
						/>
					)}
				</box>
			</box>
		)
	}

	if (viewLevel === 0) {
		return (
			<>
				<TraceListPane
					traceListProps={traceListProps}
					filterMode={filterMode}
					filterText={filterText}
					filterWidth={leftContentWidth}
					containerHeight={narrowListHeight}
					bodyHeight={narrowTraceListBodyHeight}
					padding={sectionPadding}
					scrollRef={traceListScrollRef}
				/>
				<Divider width={contentWidth} />
				<TraceDetailsPane
					trace={selectedTrace}
					traceSummary={selectedTraceSummary}
					traceStatus={traceDetailState.status}
					traceError={traceDetailState.error}
					traceLogsState={logState}
					contentWidth={rightContentWidth}
					bodyLines={narrowBodyLines}
					paneWidth={contentWidth}
					selectedSpanIndex={selectedSpanIndex}
					collapsedSpanIds={collapsedSpanIds}
					focused={false}
					onSelectSpan={selectSpan}
				/>
			</>
		)
	}

	return (
		<>
			<box paddingLeft={1} paddingRight={1} height={1} flexDirection="column">
				<TextLine>
					<span fg={colors.muted}>TRACES</span>
					{selectedTraceSummary ? (
						<>
							<span fg={colors.separator}>{"  "}{SEPARATOR}{"  "}</span>
							<span fg={viewLevel === 1 ? colors.accent : colors.muted}>{selectedTraceSummary.rootOperationName}</span>
						</>
					) : null}
					{viewLevel === 2 && selectedSpan ? (
						<>
							<span fg={colors.separator}>{"  "}{SEPARATOR}{"  "}</span>
							<span fg={colors.accent}>{selectedSpan.operationName}</span>
						</>
					) : null}
				</TextLine>
			</box>
			<Divider width={contentWidth} />
			{viewLevel === 1 ? (
				<TraceDetailsPane
					trace={selectedTrace}
					traceSummary={selectedTraceSummary}
					traceStatus={traceDetailState.status}
					traceError={traceDetailState.error}
					traceLogsState={logState}
					contentWidth={rightContentWidth}
					bodyLines={narrowFullBodyLines}
					paneWidth={contentWidth}
					selectedSpanIndex={selectedSpanIndex}
					collapsedSpanIds={collapsedSpanIds}
					focused={true}
					onSelectSpan={selectSpan}
				/>
			) : (
				<SpanDetailPane
					span={selectedSpan}
					trace={selectedTrace}
					logs={selectedSpanLogs}
					contentWidth={rightContentWidth}
					bodyLines={narrowFullBodyLines}
					paneWidth={contentWidth}
					focused={true}
				/>
			)}
		</>
	)
}
