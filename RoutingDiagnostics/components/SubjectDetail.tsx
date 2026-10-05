/** The right column: everything Dataverse knows about the selected subject. */

import * as React from "react";
import {
  Body1,
  Button,
  Body1Strong,
  Caption1,
  Subtitle2,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  makeStyles,
  shorthands,
  tokens,
} from "@fluentui/react-components";
import { LiveWorkItem, QueueItem, RoutedSubject, Session } from "../types";
import { describeOutcome } from "../services/dataverse";
import { durationBetween, elapsedLabel, stamp } from "./formatting";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    rowGap: tokens.spacingVerticalL,
    ...shorthands.padding(tokens.spacingVerticalL, tokens.spacingHorizontalL),
  },
  summary: {
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    columnGap: tokens.spacingHorizontalM,
  },
  card: {
    display: "flex",
    flexDirection: "column",
    rowGap: tokens.spacingVerticalXXS,
    ...shorthands.padding(tokens.spacingVerticalS, tokens.spacingHorizontalM),
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    ...shorthands.borderRadius(tokens.borderRadiusMedium),
    backgroundColor: tokens.colorNeutralBackground1,
  },
  cardAccent: {
    ...shorthands.border("1px", "solid", tokens.colorPaletteMarigoldBorder2),
    backgroundColor: tokens.colorPaletteMarigoldBackground1,
  },
  label: {
    color: tokens.colorNeutralForeground3,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  detail: { wordBreak: "break-all" },
  section: {
    display: "flex",
    flexDirection: "column",
    rowGap: tokens.spacingVerticalS,
  },
  sectionHead: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
  },
  lane: {
    display: "grid",
    gridTemplateColumns: "72px 1fr 260px",
    alignItems: "center",
    columnGap: tokens.spacingHorizontalM,
  },
  /** The track is the whole span of the subject; the bar inside it is placed where
   *  that run actually happened, so two runs hours apart no longer look alike. */
  track: {
    position: "relative",
    height: "28px",
    ...shorthands.borderRadius(tokens.borderRadiusSmall),
    backgroundColor: tokens.colorNeutralBackground3,
  },
  bar: {
    position: "absolute",
    top: "0",
    bottom: "0",
    display: "flex",
    minWidth: "2px",
    ...shorthands.overflow("hidden"),
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    ...shorthands.borderRadius(tokens.borderRadiusSmall),
    backgroundColor: tokens.colorNeutralBackground1,
  },
  barWaiting: {
    backgroundColor: tokens.colorNeutralBackground3,
    display: "flex",
    alignItems: "center",
    ...shorthands.padding("0", tokens.spacingHorizontalS),
    ...shorthands.overflow("hidden"),
    whiteSpace: "nowrap",
  },
  barWorking: {
    backgroundColor: tokens.colorPaletteGreenBackground2,
    display: "flex",
    alignItems: "center",
    ...shorthands.padding("0", tokens.spacingHorizontalS),
    ...shorthands.overflow("hidden"),
    whiteSpace: "nowrap",
  },
  barOffered: {
    backgroundColor: tokens.colorPaletteMarigoldBackground2,
    display: "flex",
    alignItems: "center",
    ...shorthands.padding("0", tokens.spacingHorizontalS),
    ...shorthands.overflow("hidden"),
    whiteSpace: "nowrap",
  },
  axis: {
    display: "flex",
    justifyContent: "space-between",
    color: tokens.colorNeutralForeground3,
  },
  note: {
    color: tokens.colorNeutralForeground3,
  },
  /** Section asides explain how to read the table; italic keeps them
   *  clearly apart from the data itself. */
  aside: {
    fontStyle: "italic",
    color: tokens.colorNeutralForeground3,
  },
  recordHead: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    columnGap: tokens.spacingHorizontalS,
  },
});

export interface SubjectDetailProps {
  subject: RoutedSubject;
  sessions: Session[];
  queueItems: QueueItem[];
  selectedItemId: string | null;
  onSelectItem: (item: LiveWorkItem) => void;
  onOpenRecord: (logicalName: string, id: string) => void;
}

export const SubjectDetail: React.FC<SubjectDetailProps> = ({
  subject,
  sessions,
  queueItems,
  selectedItemId,
  onSelectItem,
  onOpenRecord,
}) => {
  const styles = useStyles();
  // A resolved record keeps an inactive queue item behind it, which is not where
  // the work is now. Only an active one answers "which queue is it in".
  const current = queueItems.find((q) => q.isActive) ?? null;
  const latest = subject.latest;

  // Runs are numbered oldest first, because Run 1 is the first thing that happened,
  // but everything is listed newest first so the latest state is at the top.
  const chronological = React.useMemo(
    () =>
      [...subject.items].sort(
        (a, b) => Date.parse(a.createdOn ?? "") - Date.parse(b.createdOn ?? "")
      ),
    [subject.items]
  );

  const runNumbers = React.useMemo(() => {
    const numbers = new Map<string, number>();
    chronological.forEach((item, index) => numbers.set(item.activityid, index + 1));
    return numbers;
  }, [chronological]);

  const newestFirst = React.useMemo(() => [...chronological].reverse(), [chronological]);

  const sessionsByItem = React.useMemo(() => {
    const byItem = new Map<string, Session[]>();
    for (const session of sessions) {
      if (!session.liveWorkItemId) continue;
      const bucket = byItem.get(session.liveWorkItemId);
      if (bucket) bucket.push(session);
      else byItem.set(session.liveWorkItemId, [session]);
    }
    for (const bucket of byItem.values()) {
      bucket.sort((a, b) => Date.parse(a.createdOn ?? "") - Date.parse(b.createdOn ?? ""));
    }
    return byItem;
  }, [sessions]);

  const sessionsNewestFirst = React.useMemo(
    () =>
      [...sessions].sort(
        (a, b) => Date.parse(b.createdOn ?? "") - Date.parse(a.createdOn ?? "")
      ),
    [sessions]
  );

  const axis = React.useMemo(() => timelineAxis(chronological), [chronological]);

  // The axis ends at the last close, or at "now" while something is still open.
  // "Now" has no stored value and therefore no platform rendering, so it is named
  // rather than printed as a time.
  const axisEndLabel = React.useMemo(() => {
    const open = chronological.some((item) => !item.closedOn);
    if (open) return "now";
    const last = [...chronological]
      .sort((a, b) => Date.parse(a.closedOn ?? "") - Date.parse(b.closedOn ?? ""))
      .pop();
    return stamp(last?.closedOnLabel);
  }, [chronological]);

  return (
    <div className={styles.root}>
      <div className={styles.summary}>
        <SummaryCard
          label="Routed record"
          value={subject.title}
          detail={`${subject.logicalName ?? "conversation"} · ${subject.recordId ?? "—"}`}
          action={
            subject.logicalName && subject.recordId ? (
              <Button
                appearance="primary"
                size="small"
                onClick={() => onOpenRecord(subject.logicalName!, subject.recordId!)}
              >
                Open record
              </Button>
            ) : null
          }
        />
        <SummaryCard
          label="Workstream"
          value={subject.workstreamName ?? "—"}
          detail={latest.routableObjectLogicalName ? "Record routing" : "Conversation"}
        />
        <SummaryCard
          label="Current queue"
          value={current?.queueName ?? "Not in a queue"}
          detail={
            current
              ? `${current.stateLabel ?? "—"} · entered ${stamp(current.enteredOnLabel)}`
              : "No active queue item"
          }
        />
        <SummaryCard
          label="Outcome"
          value={subject.outcome.label}
          detail={subject.outcome.detail}
          accent={
            subject.outcome.kind === "waitingAssignment" ||
            subject.outcome.kind === "abandoned"
          }
        />
      </div>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <Subtitle2>Lifecycle</Subtitle2>
          <Caption1 className={styles.aside}>
            Each bar is one live work item, placed on a shared timeline
          </Caption1>
        </div>

        {newestFirst.map((item) => {
          const itemSessions = sessionsByItem.get(item.activityid) ?? [];
          const firstSession = itemSessions[0] ?? null;
          const lastSession = itemSessions[itemSessions.length - 1] ?? null;

          // Three spans, not two: waiting in the queue, waiting for the agent to
          // accept, and the work itself. Lumping the last two together reported a
          // day of handling as a day of being offered.
          const waitFrom = item.firstWaitStartedOn ?? item.createdOn;
          const waitedUntil = firstSession?.createdOn ?? item.closedOn;
          const waitMs = durationBetween(waitFrom, waitedUntil) ?? 0;

          const acceptedOn = firstAcceptance(itemSessions);
          const endedOn = lastSession?.closedOn ?? null;
          const offeredUntil = acceptedOn ?? endedOn;
          const offeredMs = firstSession
            ? durationBetween(firstSession.createdOn, offeredUntil) ?? 0
            : 0;
          const workingMs = acceptedOn ? durationBetween(acceptedOn, endedOn) ?? 0 : 0;

          const start = Date.parse(item.createdOn ?? "");
          const left = isNaN(start) ? 0 : ((start - axis.from) / axis.span) * 100;
          const width = ((waitMs + offeredMs + workingMs) / axis.span) * 100;

          return (
            <div key={item.activityid} className={styles.lane}>
              <Body1Strong>Run {runNumbers.get(item.activityid)}</Body1Strong>
              <div className={styles.track}>
                <div
                  className={styles.bar}
                  style={{
                    left: `${clamp(left, 0, 99)}%`,
                    width: `${clamp(width, 0.5, 100 - clamp(left, 0, 99))}%`,
                  }}
                >
                  <div className={styles.barWaiting} style={{ flexGrow: Math.max(1, waitMs) }}>
                    <Caption1>In queue · {elapsedLabel(waitFrom, waitedUntil)}</Caption1>
                  </div>
                  {firstSession && (
                    <div className={styles.barOffered} style={{ flexGrow: Math.max(1, offeredMs) }}>
                      <Caption1>
                        Offered · {elapsedLabel(firstSession.createdOn, offeredUntil)}
                      </Caption1>
                    </div>
                  )}
                  {acceptedOn && (
                    <div className={styles.barWorking} style={{ flexGrow: Math.max(1, workingMs) }}>
                      <Caption1>Working · {elapsedLabel(acceptedOn, endedOn)}</Caption1>
                    </div>
                  )}
                </div>
              </div>
              <Caption1>
                {describeOutcome(item, itemSessions.length > 0).label}
                {item.closedOn ? ` ${stamp(item.closedOnLabel)}` : ""}
                {showRawReason(item) ? ` · ${item.statusChangeReason}` : ""}
              </Caption1>
            </div>
          );
        })}

        <div className={styles.lane}>
          <span />
          <div className={styles.axis}>
            <Caption1>{stamp(chronological[0]?.createdOnLabel)}</Caption1>
            <Caption1>{axisEndLabel}</Caption1>
          </div>
          <span />
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <Subtitle2>Routing attempts · {newestFirst.length}</Subtitle2>
          <Caption1 className={styles.aside}>
            Select a row to read its Application Insights trace
          </Caption1>
        </div>
        <Table size="small" aria-label="Routing attempts">
          <TableHeader>
            <TableRow>
              <TableHeaderCell>Run</TableHeaderCell>
              <TableHeaderCell>Created</TableHeaderCell>
              <TableHeaderCell>Queue</TableHeaderCell>
              <TableHeaderCell>Live work item</TableHeaderCell>
              <TableHeaderCell>Agent</TableHeaderCell>
              <TableHeaderCell>State</TableHeaderCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {newestFirst.map((item) => {
              const itemSessions = sessionsByItem.get(item.activityid) ?? [];
              const selected = item.activityid === selectedItemId;
              return (
                <TableRow
                  key={item.activityid}
                  appearance={selected ? "brand" : "none"}
                  onClick={() => onSelectItem(item)}
                  style={{ cursor: "pointer" }}
                >
                  <TableCell>{runNumbers.get(item.activityid)}</TableCell>
                  <TableCell>{stamp(item.createdOnLabel)}</TableCell>
                  <TableCell>{item.queueName ?? "—"}</TableCell>
                  <TableCell>
                    {item.statecode === 0
                      ? "Open"
                      : `Closed ${stamp(item.closedOnLabel)}`}
                  </TableCell>
                  <TableCell>
                    {item.activeAgentName ??
                      (itemSessions.length > 0 ? "Offered, agent unknown" : "Never offered")}
                  </TableCell>
                  <TableCell>
                    {showRawReason(item)
                      ? item.statusChangeReason
                      : describeOutcome(item, itemSessions.length > 0).label}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <Subtitle2>Sessions · {sessions.length}</Subtitle2>
          <Caption1 className={styles.aside}>
            Closure reasons are shown as recorded, not interpreted
          </Caption1>
        </div>

        {sessions.length === 0 ? (
          <Body1 className={styles.note}>
            No session was created, so no agent was ever notified. That is what separates
            an offer that timed out from work that is still waiting in the queue.
          </Body1>
        ) : (
          <Table size="small" aria-label="Sessions">
            <TableHeader>
              <TableRow>
                <TableHeaderCell>Run</TableHeaderCell>
                <TableHeaderCell>Created</TableHeaderCell>
                <TableHeaderCell>Closed</TableHeaderCell>
                <TableHeaderCell>Closure reason</TableHeaderCell>
                <TableHeaderCell>Agent</TableHeaderCell>
                <TableHeaderCell>Accepted</TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessionsNewestFirst.map((session) => {
                const primary = session.participants[0];
                const run = session.liveWorkItemId
                  ? runNumbers.get(session.liveWorkItemId)
                  : undefined;
                return (
                  <TableRow key={session.activityid}>
                    <TableCell>{run ?? "—"}</TableCell>
                    <TableCell>{stamp(session.createdOnLabel)}</TableCell>
                    <TableCell>{stamp(session.closedOnLabel)}</TableCell>
                    <TableCell>{session.closureReason ?? "—"}</TableCell>
                    <TableCell>{primary?.agentName ?? "—"}</TableCell>
                    <TableCell>
                      {primary
                        ? primary.joinedOn
                          ? stamp(primary.joinedOnLabel)
                          : "Never joined"
                        : "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
};

interface SummaryCardProps {
  label: string;
  value: string;
  detail?: string | null;
  accent?: boolean;
  action?: React.ReactNode;
}

const SummaryCard: React.FC<SummaryCardProps> = ({ label, value, detail, accent, action }) => {
  const styles = useStyles();
  return (
    <div className={accent ? `${styles.card} ${styles.cardAccent}` : styles.card}>
      <div className={styles.recordHead}>
        <Caption1 className={styles.label}>{label}</Caption1>
        {action}
      </div>
      <Body1Strong>{value}</Body1Strong>
      {detail && <Caption1 className={styles.detail}>{detail}</Caption1>}
    </div>
  );
};

/** msdyn_statuschangereason records the last status change, not the current state.
 *  Record routing in push mode stamps it when the work is handed to an agent and
 *  never writes anything after that, so a record someone already owns still reads
 *  "AwaitingAgentAcceptance". Showing it there says the opposite of what happened,
 *  so the raw value is kept only for conversations, where acceptance is a real step. */
function showRawReason(item: LiveWorkItem): boolean {
  if (!item.statusChangeReason) return false;
  const isRecordRouting = item.routableObjectLogicalName !== null;
  return !isRecordRouting;
}

/** One axis for every run: from the first attempt to the last close, or to now while
 *  something is still open. Bars are then placed on it rather than each being drawn
 *  from the left, which used to make a run hours later look simultaneous. */
function timelineAxis(items: LiveWorkItem[]): { from: number; to: number; span: number } {
  let from = Number.POSITIVE_INFINITY;
  let to = Number.NEGATIVE_INFINITY;

  for (const item of items) {
    const start = Date.parse(item.createdOn ?? "");
    if (!isNaN(start)) from = Math.min(from, start);
    const end = item.closedOn ? Date.parse(item.closedOn) : Date.now();
    if (!isNaN(end)) to = Math.max(to, end);
  }

  if (!isFinite(from) || !isFinite(to)) {
    const now = Date.now();
    return { from: now, to: now + 1, span: 1 };
  }

  return { from, to, span: Math.max(1, to - from) };
}

/** When the agent took the work. The session records it, and the participant row
 *  carries it too for the sessions that predate that column being written. */
function firstAcceptance(sessions: Session[]): string | null {
  for (const session of sessions) {
    const accepted = session.agentAcceptedOn ?? session.participants[0]?.joinedOn ?? null;
    if (accepted) return accepted;
  }
  return null;
}

function clamp(value: number, min: number, max: number): number {
  if (isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}