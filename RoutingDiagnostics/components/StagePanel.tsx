/** Application Insights stages for one live work item.
 *
 *  This is the half of the picture Dataverse cannot give: which rules ran, what they
 *  decided, and why assignment did or did not happen. */

import * as React from "react";
import {
  Badge,
  Body1,
  Button,
  Body1Strong,
  Caption1,
  Link,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  Tab,
  TabList,
  makeStyles,
  shorthands,
  tokens,
} from "@fluentui/react-components";
import { DiagnosticRequest, RuleStatus, Stage } from "../types";
import { formatDuration, prettyJson, stamp } from "./formatting";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    rowGap: tokens.spacingVerticalL,
    ...shorthands.padding(tokens.spacingVerticalL, tokens.spacingHorizontalL),
  },
  timeline: {
    display: "flex",
    flexDirection: "column",
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    ...shorthands.borderRadius(tokens.borderRadiusMedium),
    backgroundColor: tokens.colorNeutralBackground1,
    ...shorthands.overflow("hidden"),
  },
  stepRow: {
    display: "flex",
    flexDirection: "column",
  },
  step: {
    display: "flex",
    alignItems: "stretch",
    columnGap: tokens.spacingHorizontalM,
    ...shorthands.padding(tokens.spacingVerticalS, tokens.spacingHorizontalM),
    ...shorthands.borderLeft("3px", "solid", "transparent"),
    cursor: "pointer",
    ":hover": { backgroundColor: tokens.colorNeutralBackground1Hover },
  },
  stepSelected: {
    backgroundColor: tokens.colorNeutralBackground1Selected,
    ...shorthands.borderLeft("3px", "solid", tokens.colorBrandStroke1),
  },
  // The time sits in its own column so every row lines up as a ruler down the page.
  when: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    minWidth: "150px",
    color: tokens.colorNeutralForeground3,
  },
  rail: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    width: "12px",
    flexShrink: 0,
  },
  dot: {
    width: "10px",
    height: "10px",
    marginTop: "5px",
    ...shorthands.borderRadius("50%"),
    backgroundColor: tokens.colorNeutralForeground3,
    flexShrink: 0,
  },
  dotFailed: { backgroundColor: tokens.colorPaletteRedForeground1 },
  dotWarning: { backgroundColor: tokens.colorPaletteYellowForeground1 },
  dotSuccess: { backgroundColor: tokens.colorPaletteGreenForeground1 },
  line: {
    flexGrow: 1,
    width: "2px",
    backgroundColor: tokens.colorNeutralStroke2,
    marginTop: tokens.spacingVerticalXXS,
  },
  stepBody: {
    display: "flex",
    flexDirection: "column",
    rowGap: tokens.spacingVerticalXXS,
    minWidth: 0,
    paddingBottom: tokens.spacingVerticalXS,
    flexGrow: 1,
  },
  stepTitle: {
    display: "flex",
    alignItems: "baseline",
    columnGap: tokens.spacingHorizontalS,
    flexWrap: "wrap",
  },
  chevron: {
    color: tokens.colorNeutralForeground3,
    marginLeft: "auto",
    paddingLeft: tokens.spacingHorizontalS,
  },
  muted: { color: tokens.colorNeutralForeground3 },
  /** The detail lives under the row it belongs to, indented past the rail so the
   *  timeline still reads as one line down the page. */
  detail: {
    display: "flex",
    flexDirection: "column",
    rowGap: tokens.spacingVerticalM,
    marginLeft: "178px",
    ...shorthands.padding(tokens.spacingVerticalM, tokens.spacingHorizontalM),
    ...shorthands.borderTop("1px", "solid", tokens.colorNeutralStroke2),
    backgroundColor: tokens.colorNeutralBackground2,
  },
  label: {
    color: tokens.colorNeutralForeground3,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  section: {
    display: "flex",
    flexDirection: "column",
    rowGap: tokens.spacingVerticalS,
  },
  facts: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    columnGap: tokens.spacingHorizontalXL,
    rowGap: tokens.spacingVerticalXS,
  },
  fact: {
    display: "flex",
    justifyContent: "space-between",
    columnGap: tokens.spacingHorizontalM,
  },
  factLabel: { color: tokens.colorNeutralForeground3, flexShrink: 0 },
  factValue: { textAlign: "right", wordBreak: "break-word" },
  code: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    lineHeight: tokens.lineHeightBase300,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    maxHeight: "320px",
    overflowY: "auto",
    ...shorthands.padding(tokens.spacingVerticalM, tokens.spacingHorizontalM),
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    ...shorthands.borderRadius(tokens.borderRadiusMedium),
    backgroundColor: tokens.colorNeutralBackground3,
  },
  condition: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground2,
  },
  centre: {
    display: "flex",
    justifyContent: "center",
    ...shorthands.padding(tokens.spacingVerticalXXL, "0"),
  },
});

/** What each stage actually did, in words. Application Insights names the stage and
 *  nothing else, and the names assume you already know unified routing; a support
 *  engineer reading a trace for the first time does not. Anything missing from this
 *  map keeps its raw name and simply carries no sentence. */
const STAGE_DESCRIPTIONS: Record<string, string> = {
  ConversationCreated: "A live work item was created for the routable record",
  ConversationDetails: "The work item's routing details were captured",
  RecordDetails: "The routed record's details were captured",
  RecordIdentification: "The incoming work was matched to a record",
  RecordBuffered: "The record was held before routing started",
  Intake: "The work entered unified routing",
  Classification: "Classification rules ran and set the routing attributes",
  RouteToQueue: "Route to queue rules ran and picked the queue",
  CSRAssignment: "Unified routing tried to assign an agent",
  CSRAccepted: "The agent accepted the work",
  CSRRejected: "The agent rejected the work",
  SupervisorInitiatedTransfer: "A supervisor started a transfer",
  AgentInitiatedTransfer: "An agent started a transfer",
  TransferAssignment: "The transfer target was assigned",
  ConversationClosed: "The work item was closed",
};

type StageTone = "neutral" | "failed" | "warning" | "success";

function stageTone(stage: Stage): StageTone {
  if (stage.assignment && !stage.assignment.isAgentAssigned) return "failed";
  if (stage.subscenario.includes("Transfer")) return "warning";
  if (stage.subscenario.includes("Accepted")) return "success";
  if (stage.subscenario.includes("Rejected")) return "failed";
  return "neutral";
}

/** The one fact that stage decided, so the timeline reads without opening anything. */
function stageSummary(stage: Stage, labels: LabelMap): string | null {
  if (stage.assignment) {
    if (stage.assignment.isAgentAssigned) {
      const agentId = stage.assignment.agent?.agentId ?? null;
      const name = agentId ? labels.get(agentId.toLowerCase()) : null;
      return name ? `Assigned to ${name}` : "An agent was assigned";
    }
    return stage.assignment.reason ?? "No agent was assigned";
  }
  if (stage.subscenario === "RouteToQueue") return stage.queueName ?? stage.outcome;
  return stage.outcome;
}

const RULE_STATUS: Record<RuleStatus, { label: string; color: "success" | "informative" | "subtle" }> = {
  applied: { label: "Matched", color: "success" },
  processed: { label: "Evaluated", color: "informative" },
  notProcessed: { label: "Skipped", color: "subtle" },
  unknown: { label: "Unknown", color: "subtle" },
};

/** Names for the ids a trace carries, keyed by lowercase id. */
export type LabelMap = Map<string, string>;

export interface StagePanelProps {
  loading: boolean;
  request: DiagnosticRequest | null;
  stages: Stage[];
  labels: LabelMap;
  onOpenRecord: (logicalName: string, id: string) => void;
  /** Results are cached per attempt, so asking again is a deliberate act. */
  onRerun: () => void;
}

export const StagePanel: React.FC<StagePanelProps> = ({
  loading,
  request,
  stages,
  labels,
  onOpenRecord,
  onRerun,
}) => {
  const styles = useStyles();
  const [openKey, setOpenKey] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState<string>("rules");

  // When a new trace arrives, open the stage that explains the outcome: the one
  // that failed, else the last.
  React.useEffect(() => {
    if (stages.length === 0) {
      setOpenKey(null);
      return;
    }
    const failed = stages.find((s) => s.assignment && !s.assignment.isAgentAssigned);
    setOpenKey((failed ?? stages[stages.length - 1]).key);
  }, [stages]);

  if (loading) {
    return (
      <div className={styles.centre}>
        <Spinner label="Reading Application Insights" />
      </div>
    );
  }

  if (!request) {
    return (
      <div className={styles.root}>
        <Body1>Select a routing attempt to read its trace.</Body1>
      </div>
    );
  }

  if (request.status !== "succeeded") {
    return (
      <div className={styles.root}>
        <RequestProblem request={request} />
        <div>
          <Button appearance="secondary" size="small" onClick={onRerun}>
            Re-run query
          </Button>
        </div>
      </div>
    );
  }

  // A succeeded query that returned nothing is the common case when the resource
  // the flow reads is not the one this environment writes to, so say that rather
  // than drawing an empty panel.
  if (stages.length === 0) {
    return (
      <div className={styles.root}>
        <MessageBar intent="info">
          <MessageBarBody>
            <MessageBarTitle>The query ran but found nothing</MessageBarTitle>
            No traces matched this conversation. Either Application Insights has not
            received them yet, which can take up to fifteen minutes, or the resource
            the flow reads is not the one this environment writes to.
          </MessageBarBody>
        </MessageBar>
        <div>
          <Button appearance="secondary" size="small" onClick={onRerun}>
            Re-run query
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      {request.isTruncated && (
        <MessageBar intent="warning">
          <MessageBarBody>
            <MessageBarTitle>Results were truncated</MessageBarTitle>
            Only the first {request.eventCount} traces were read. Narrow the window to
            see the rest.
          </MessageBarBody>
        </MessageBar>
      )}

      <div className={styles.timeline} role="list">
        {stages.map((stage, index) => {
          const isOpen = stage.key === openKey;
          const tone = stageTone(stage);
          const summary = stageSummary(stage, labels);
          const description = STAGE_DESCRIPTIONS[stage.subscenario] ?? null;

          const dotClass = [
            styles.dot,
            tone === "failed" ? styles.dotFailed : "",
            tone === "warning" ? styles.dotWarning : "",
            tone === "success" ? styles.dotSuccess : "",
          ]
            .filter(Boolean)
            .join(" ");

          const toggle = (): void => setOpenKey(isOpen ? null : stage.key);

          return (
            <div key={stage.key} className={styles.stepRow} role="listitem">
              <div
                tabIndex={0}
                role="button"
                aria-expanded={isOpen}
                className={isOpen ? `${styles.step} ${styles.stepSelected}` : styles.step}
                onClick={toggle}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    toggle();
                  }
                }}
              >
                <div className={styles.when}>
                  <Caption1>{stamp(stage.timestampLabel)}</Caption1>
                  <Caption1>{formatDuration(stage.durationMs)}</Caption1>
                </div>
                <div className={styles.rail} aria-hidden="true">
                  <div className={dotClass} />
                  {index < stages.length - 1 && <div className={styles.line} />}
                </div>
                <div className={styles.stepBody}>
                  <div className={styles.stepTitle}>
                    <Body1Strong>{stage.subscenario}</Body1Strong>
                    {stage.parts > 1 && (
                      <Caption1 className={styles.muted}>{stage.parts} parts</Caption1>
                    )}
                  </div>
                  {description && (
                    <Caption1 className={styles.muted}>{description}</Caption1>
                  )}
                  {summary && (
                    <Body1
                      style={
                        tone === "failed"
                          ? { color: tokens.colorPaletteRedForeground1 }
                          : undefined
                      }
                    >
                      {summary}
                    </Body1>
                  )}
                </div>
                <Caption1 className={styles.chevron} aria-hidden="true">
                  {isOpen ? "▲" : "▼"}
                </Caption1>
              </div>

              {isOpen && (
                <div className={styles.detail}>
                  <TabList
                    selectedValue={tab}
                    onTabSelect={(_, d) => setTab(String(d.value))}
                  >
                    <Tab value="rules">Rules ({stage.rules.length})</Tab>
                    <Tab value="workitem">Work item</Tab>
                    <Tab value="assignment">Assignment</Tab>
                    <Tab value="payload">Payload</Tab>
                  </TabList>

                  {tab === "rules" && <RuleTable stage={stage} />}
                  {tab === "workitem" && (
                    <WorkItemFacts
                      stage={stage}
                      labels={labels}
                      onOpenRecord={onOpenRecord}
                    />
                  )}
                  {tab === "assignment" && (
                    <AssignmentFacts
                      stage={stage}
                      labels={labels}
                      onOpenRecord={onOpenRecord}
                    />
                  )}
                  {tab === "payload" && (
                    <div className={styles.code}>
                      {stage.payloads.map(prettyJson).join("\n\n") || "No payload"}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

const Fact: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => {
  const styles = useStyles();
  return (
    <div className={styles.fact}>
      <Caption1 className={styles.factLabel}>{label}</Caption1>
      <Caption1 className={styles.factValue}>{value}</Caption1>
    </div>
  );
};

/** An id the trace logged, shown by name where Dataverse knows one and opening the
 *  record when clicked. The raw id stays visible when nothing resolved it, because
 *  a wrong name would be worse than a bare id. */
const RecordLink: React.FC<{
  entity: string;
  id: string | null;
  labels: LabelMap;
  onOpenRecord: (logicalName: string, id: string) => void;
}> = ({ entity, id, labels, onOpenRecord }) => {
  if (!id) return <>—</>;
  const name = labels.get(id.toLowerCase()) ?? id;
  return (
    <Link
      onClick={(e) => {
        e.preventDefault();
        onOpenRecord(entity, id);
      }}
      href="#"
    >
      {name}
    </Link>
  );
};

/** Several ids of the same kind, each one its own link. */
const RecordLinks: React.FC<{
  entity: string;
  ids: string[];
  empty: string;
  labels: LabelMap;
  onOpenRecord: (logicalName: string, id: string) => void;
}> = ({ entity, ids, empty, labels, onOpenRecord }) => {
  if (ids.length === 0) return <>{empty}</>;
  return (
    <>
      {ids.map((id, index) => (
        <React.Fragment key={id}>
          {index > 0 && ", "}
          <RecordLink
            entity={entity}
            id={id}
            labels={labels}
            onOpenRecord={onOpenRecord}
          />
        </React.Fragment>
      ))}
    </>
  );
};

const GUID = /^\{?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}?$/i;

export function isGuid(value: string | null | undefined): boolean {
  return typeof value === "string" && GUID.test(value.trim());
}

const RuleTable: React.FC<{ stage: Stage }> = ({ stage }) => {
  const styles = useStyles();

  if (stage.rules.length === 0) {
    return <Body1>This stage logged no rule executions.</Body1>;
  }

  return (
    <Table size="small" aria-label="Rule executions">
      <TableHeader>
        <TableRow>
          <TableHeaderCell style={{ width: "56px" }}>#</TableHeaderCell>
          <TableHeaderCell style={{ width: "110px" }}>Status</TableHeaderCell>
          <TableHeaderCell>Rule</TableHeaderCell>
          <TableHeaderCell>Output</TableHeaderCell>
        </TableRow>
      </TableHeader>
      <TableBody>
        {stage.rules.map((rule) => {
          const status = RULE_STATUS[rule.status];
          return (
            <TableRow key={`${rule.ruleId}-${rule.order}`}>
              <TableCell>{rule.order ?? "—"}</TableCell>
              <TableCell>
                <Badge appearance="outline" color={status.color} size="small">
                  {status.label}
                </Badge>
              </TableCell>
              <TableCell>
                <div>
                  <Body1Strong>{rule.name ?? "—"}</Body1Strong>
                  {rule.condition && (
                    <div className={styles.condition}>{rule.condition}</div>
                  )}
                </div>
              </TableCell>
              <TableCell>{rule.output ?? "—"}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
};

const WorkItemFacts: React.FC<{
  stage: Stage;
  labels: LabelMap;
  onOpenRecord: (logicalName: string, id: string) => void;
}> = ({ stage, labels, onOpenRecord }) => {
  const styles = useStyles();
  const details = stage.workItemDetails;

  if (!details) return <Body1>This stage carries no work item details.</Body1>;

  return (
    <div className={styles.facts}>
      <Fact
        label="Session"
        value={
          <RecordLink
            entity="msdyn_ocsession"
            id={details.sessionId}
            labels={labels}
            onOpenRecord={onOpenRecord}
          />
        }
      />
      <Fact
        label="Queue"
        value={
          <RecordLink
            entity="queue"
            id={details.queueId}
            labels={labels}
            onOpenRecord={onOpenRecord}
          />
        }
      />
      <Fact
        label="Workstream"
        value={
          <RecordLink
            entity="msdyn_liveworkstream"
            id={details.workstreamId}
            labels={labels}
            onOpenRecord={onOpenRecord}
          />
        }
      />
      <Fact
        label="Required capacity"
        value={details.requiredCapacityUnits?.toString() ?? "—"}
      />
      <Fact
        label="Allowed presences"
        value={details.allowedPresences.join(", ") || "—"}
      />
      <Fact
        label="Required skills"
        value={
          <SkillList
            values={details.requiredSkills}
            empty="none"
            labels={labels}
            onOpenRecord={onOpenRecord}
          />
        }
      />
      <Fact
        label="Capacity profiles"
        value={details.capacityProfiles.join(", ") || "unit based"}
      />
      <Fact label="Reservation" value={details.reservationType ?? "—"} />
    </div>
  );
};

/** Skills arrive as names when routing logged them and as ids when it did not, so
 *  each entry is linked only when it is an id. */
const SkillList: React.FC<{
  values: string[];
  empty: string;
  labels: LabelMap;
  onOpenRecord: (logicalName: string, id: string) => void;
}> = ({ values, empty, labels, onOpenRecord }) => {
  if (values.length === 0) return <>{empty}</>;
  return (
    <>
      {values.map((value, index) => (
        <React.Fragment key={`${value}-${index}`}>
          {index > 0 && ", "}
          {isGuid(value) ? (
            <RecordLink
              entity="characteristic"
              id={value}
              labels={labels}
              onOpenRecord={onOpenRecord}
            />
          ) : (
            value
          )}
        </React.Fragment>
      ))}
    </>
  );
};

const AssignmentFacts: React.FC<{
  stage: Stage;
  labels: LabelMap;
  onOpenRecord: (logicalName: string, id: string) => void;
}> = ({ stage, labels, onOpenRecord }) => {
  const styles = useStyles();
  const assignment = stage.assignment;

  if (!assignment) return <Body1>This stage is not an assignment attempt.</Body1>;

  const agent = assignment.agent;

  return (
    <div className={styles.section}>
      {!assignment.isAgentAssigned && assignment.reason && (
        <MessageBar intent="error">
          <MessageBarBody>
            <MessageBarTitle>No agent was assigned</MessageBarTitle>
            {assignment.reason}
          </MessageBarBody>
        </MessageBar>
      )}
      <div className={styles.facts}>
        <Fact label="Method" value={assignment.method ?? "—"} />
        <Fact label="Assigned" value={assignment.isAgentAssigned ? "Yes" : "No"} />
        {assignment.rulesExecuted &&
          Object.entries(assignment.rulesExecuted).map(([key, value]) => (
            <Fact
              key={key}
              label={key}
              value={
                isGuid(value) && key.toLowerCase().includes("ruleset") ? (
                  <RecordLink
                    entity="msdyn_decisionruleset"
                    id={value}
                    labels={labels}
                    onOpenRecord={onOpenRecord}
                  />
                ) : (
                  value ?? "none"
                )
              }
            />
          ))}
      </div>

      {/* The work item tab says what was demanded; this says what the chosen agent
          had, so the two can be read against each other. */}
      {agent && (
        <>
          <Caption1 className={styles.label}>Assigned agent</Caption1>
          <div className={styles.facts}>
            <Fact
              label="Agent"
              value={
                <RecordLink
                  entity="systemuser"
                  id={agent.agentId}
                  labels={labels}
                  onOpenRecord={onOpenRecord}
                />
              }
            />
            <Fact label="Presence" value={agent.presence ?? "—"} />
            <Fact
              label="Skills"
              value={
                <SkillList
                  values={agent.skills}
                  empty="none recorded"
                  labels={labels}
                  onOpenRecord={onOpenRecord}
                />
              }
            />
            <Fact
              label="Available capacity"
              value={agent.availableCapacityUnits?.toString() ?? "—"}
            />
            <Fact
              label="Capacity profiles"
              value={agent.capacityProfiles.join(", ") || "unit based"}
            />
            <Fact
              label="Active sessions"
              value={agent.activeSessionCount?.toString() ?? "—"}
            />
          </div>
        </>
      )}
    </div>
  );
};

/** Every unhappy path says what happened and what to do, because the usual reader is
 *  a support engineer who cannot see the flow or the Azure resource. */
const RequestProblem: React.FC<{ request: DiagnosticRequest }> = ({ request }) => {
  switch (request.status) {
    case "nodata":
      return (
        <MessageBar intent="info">
          <MessageBarBody>
            <MessageBarTitle>No trace yet</MessageBarTitle>
            Application Insights has nothing for this conversation. Routing data can take
            up to fifteen minutes to arrive.
          </MessageBarBody>
        </MessageBar>
      );
    case "timeout":
      return (
        <MessageBar intent="warning">
          <MessageBarBody>
            <MessageBarTitle>Still waiting</MessageBarTitle>
            {request.statusMessage ?? "The request did not finish in time."}
          </MessageBarBody>
        </MessageBar>
      );
    default:
      return (
        <MessageBar intent="error">
          <MessageBarBody>
            <MessageBarTitle>The query failed</MessageBarTitle>
            {request.statusMessage ?? "No detail was recorded."}
          </MessageBarBody>
        </MessageBar>
      );
  }
};