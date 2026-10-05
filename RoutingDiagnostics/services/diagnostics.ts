/** Application Insights data, fetched through Dataverse.
 *
 *  The control cannot query Application Insights from the browser, so it writes a
 *  request row, a flow picks it up, runs the KQL and writes the events back. This
 *  module owns that handshake and the parsing of what comes back. */

import {
  AssignedAgent,
  AssignmentDetails,
  DiagnosticEvent,
  DiagnosticRequest,
  RequestStatus,
  RuleExecution,
  RuleStatus,
  Stage,
  WorkItemDetails,
} from "../types";

type WebApi = ComponentFramework.WebApi;

const REQUEST_TABLE = "plt_urd_diagnosticrequest";
const REQUEST_SET = "plt_urd_diagnosticrequests";
const EVENT_TABLE = "plt_urd_routingdiagnosticevent";

/** Status choice values on plt_urd_diagnosticrequest. */
const STATUS_VALUES: Record<number, RequestStatus> = {
  10: "queued",
  20: "running",
  30: "succeeded",
  40: "nodata",
  50: "error",
};

/** Application Insights lags routing by up to fifteen minutes, so polling has to be
 *  patient. These are deliberately generous. */
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 90000;

export interface DiagnosticsResult {
  request: DiagnosticRequest;
  stages: Stage[];
}

/** Create a request row, wait for the flow to finish it, then read the events.
 *  Returns as soon as the request reaches a terminal status. */
export async function loadDiagnostics(
  webAPI: WebApi,
  conversationId: string,
  windowStart: Date,
  windowEnd: Date,
  signal?: { cancelled: boolean }
): Promise<DiagnosticsResult> {
  const created = await webAPI.createRecord(REQUEST_TABLE, {
    plt_name: `Routing diagnostics ${conversationId}`,
    plt_conversationid: conversationId,
    plt_windowstart: windowStart.toISOString(),
    plt_windowend: windowEnd.toISOString(),
    plt_requestedon: new Date().toISOString(),
  });

  const request = await pollUntilDone(webAPI, created.id, signal);
  if (request.status !== "succeeded") {
    return { request, stages: [] };
  }

  const events = await fetchEvents(webAPI, created.id);
  return { request, stages: buildStages(events) };
}

async function pollUntilDone(
  webAPI: WebApi,
  requestId: string,
  signal?: { cancelled: boolean }
): Promise<DiagnosticRequest> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  for (;;) {
    if (signal?.cancelled) {
      return terminal(requestId, "timeout", "Cancelled");
    }

    const row = await webAPI.retrieveRecord(
      REQUEST_TABLE,
      requestId,
      "?$select=plt_statuscode,plt_statusmessage,plt_eventcount,plt_istruncated,plt_completedon"
    );

    const status = STATUS_VALUES[Number(row["plt_statuscode"])] ?? "queued";
    if (status !== "queued" && status !== "running") {
      return {
        id: requestId,
        status,
        statusMessage: (row["plt_statusmessage"] as string) ?? null,
        eventCount: row["plt_eventcount"] != null ? Number(row["plt_eventcount"]) : null,
        isTruncated: row["plt_istruncated"] === true,
        completedOn: (row["plt_completedon"] as string) ?? null,
      };
    }

    if (Date.now() > deadline) {
      const stalled = status === "queued";
      return terminal(
        requestId,
        "timeout",
        stalled
          ? "The request was never picked up. The flow may be turned off."
          : "The query is still running. Try again in a moment."
      );
    }

    await delay(POLL_INTERVAL_MS);
  }
}

function terminal(id: string, status: RequestStatus, message: string): DiagnosticRequest {
  return {
    id,
    status,
    statusMessage: message,
    eventCount: null,
    isTruncated: false,
    completedOn: null,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function fetchEvents(webAPI: WebApi, requestId: string): Promise<DiagnosticEvent[]> {
  // Several stages land in the same second, and plt_timestamp is stored at second
  // precision, so ordering on it alone shuffles them. The flow numbers the rows as
  // it writes them, and that is the order the trace actually happened in.
  const query =
    "?$select=plt_urd_routingdiagnosticeventid,plt_timestamp,plt_sequence,plt_subscenario," +
    "plt_channeltype,plt_part,plt_partcount,plt_queueid,plt_queuename," +
    "plt_workstreamid,plt_outcome,plt_additionalinfo,plt_result,plt_payload" +
    `&$filter=_plt_urd_diagnosticrequestid_value eq ${requestId}` +
    "&$orderby=plt_sequence asc,plt_timestamp asc";

  const result = await webAPI.retrieveMultipleRecords(EVENT_TABLE, query);
  return result.entities.map((row) => ({
    id: String(row["plt_urd_routingdiagnosticeventid"]),
    timestamp: (row["plt_timestamp"] as string) ?? null,
    timestampLabel:
      (row["plt_timestamp@OData.Community.Display.V1.FormattedValue"] as string) ?? null,
    sequence: row["plt_sequence"] != null ? Number(row["plt_sequence"]) : null,
    subscenario: (row["plt_subscenario"] as string) ?? null,
    channelType: (row["plt_channeltype"] as string) ?? null,
    part: row["plt_part"] != null ? Number(row["plt_part"]) : null,
    partCount: row["plt_partcount"] != null ? Number(row["plt_partcount"]) : null,
    queueId: (row["plt_queueid"] as string) ?? null,
    queueName: (row["plt_queuename"] as string) ?? null,
    workstreamId: (row["plt_workstreamid"] as string) ?? null,
    outcome: (row["plt_outcome"] as string) ?? null,
    additionalInfo: (row["plt_additionalinfo"] as string) ?? null,
    result: (row["plt_result"] as string) ?? null,
    payload: (row["plt_payload"] as string) ?? null,
  }));
}

/** Turn raw traces into the stages the UI draws.
 *
 *  Route to queue arrives split across several traces, each carrying a slice of the
 *  rule set and all sharing a timestamp. Showing them as separate stages would both
 *  repeat the stage four times and make the rule list look truncated, so parts are
 *  merged back into one stage with the rules concatenated in order. */
export function buildStages(events: DiagnosticEvent[]): Stage[] {
  const byKey = new Map<string, DiagnosticEvent[]>();

  for (const event of events) {
    const key = `${event.subscenario ?? "unknown"}|${event.timestamp ?? ""}`;
    const bucket = byKey.get(key);
    if (bucket) bucket.push(event);
    else byKey.set(key, [event]);
  }

  const stages: Stage[] = [];
  byKey.forEach((bucket, key) => {
    bucket.sort((a, b) => (a.part ?? 0) - (b.part ?? 0));
    const first = bucket[0];
    const info = bucket.map((e) => parseRuleSet(e.additionalInfo));

    stages.push({
      key,
      subscenario: first.subscenario ?? "Unknown",
      sequence: first.sequence,
      timestamp: first.timestamp,
      timestampLabel: first.timestampLabel,
      durationMs: null,
      queueName: first.queueName,
      outcome: first.outcome,
      ruleSetName: info.find((i) => i.name)?.name ?? null,
      ruleHitPolicy: info.find((i) => i.hitPolicy)?.hitPolicy ?? null,
      rules: info.flatMap((i) => i.rules).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
      parts: bucket.length,
      workItemDetails: parseWorkItemDetails(first.payload),
      assignment: parseAssignment(first.payload, first.result, first.outcome),
      payloads: bucket.map((e) => e.payload ?? "").filter(Boolean),
    });
  });

  // Sequence first, timestamp only where the flow never wrote one.
  stages.sort((a, b) => {
    if (a.sequence !== null && b.sequence !== null) return a.sequence - b.sequence;
    return Date.parse(a.timestamp ?? "") - Date.parse(b.timestamp ?? "");
  });

  // Each stage lasts until the next one starts; the trace carries no duration.
  for (let i = 0; i < stages.length - 1; i++) {
    const from = Date.parse(stages[i].timestamp ?? "");
    const to = Date.parse(stages[i + 1].timestamp ?? "");
    if (!isNaN(from) && !isNaN(to)) stages[i].durationMs = to - from;
  }

  return stages;
}

interface ParsedRuleSet {
  name: string | null;
  hitPolicy: string | null;
  rules: RuleExecution[];
}

const EMPTY_RULE_SET: ParsedRuleSet = { name: null, hitPolicy: null, rules: [] };

function parseRuleSet(additionalInfo: string | null): ParsedRuleSet {
  const parsed = safeParse(additionalInfo);
  if (!parsed || typeof parsed !== "object") return EMPTY_RULE_SET;

  const raw = parsed as Record<string, unknown>;
  const ruleSetInfo = Array.isArray(raw.RuleSetInfo) ? raw.RuleSetInfo : [];

  return {
    name: asString(raw.RuleSetName),
    hitPolicy: asString(raw.RuleHitPolicy),
    rules: ruleSetInfo.map((entry) => toRuleExecution(entry as Record<string, unknown>)),
  };
}

function toRuleExecution(entry: Record<string, unknown>): RuleExecution {
  return {
    ruleId: asString(entry.RuleId),
    order: typeof entry.Order === "number" ? entry.Order : null,
    name: asString(entry.RuleItem),
    condition: asString(entry.Condition),
    status: normaliseRuleStatus(entry.Status),
    output: describeRuleOutput(entry.Output),
  };
}

/** Classification writes "Applied" or omits the field; route to queue writes a number,
 *  where the matched rule carries 3 and the rest carry 1. Both reach the UI as one
 *  vocabulary, so a reader does not have to know which stage they are looking at. */
function normaliseRuleStatus(status: unknown): RuleStatus {
  if (typeof status === "string") {
    const lower = status.toLowerCase();
    if (lower === "applied") return "applied";
    if (lower === "processed") return "processed";
    if (lower === "not processed" || lower === "notprocessed") return "notProcessed";
    return "unknown";
  }
  if (typeof status === "number") {
    if (status === 3) return "applied";
    if (status === 1) return "processed";
    return "unknown";
  }
  return "unknown";
}

/** Classification outputs a string, route to queue an array of queues. */
function describeRuleOutput(output: unknown): string | null {
  if (typeof output === "string") return output;
  if (Array.isArray(output)) {
    const names = output
      .map((o) => asString((o as Record<string, unknown>)?.DisplayName))
      .filter((n): n is string => Boolean(n));
    return names.length > 0 ? names.join(", ") : null;
  }
  return null;
}

function parseWorkItemDetails(payload: string | null): WorkItemDetails | null {
  const root = safeParse(payload) as Record<string, unknown> | null;
  if (!root) return null;

  const details = safeParse(asString(root["omnichannel.work_item.details"]));
  if (!details || typeof details !== "object") return null;

  const d = details as Record<string, unknown>;
  return {
    sessionId: asString(d.SessionId),
    queueId: asString(d.QueueId),
    workstreamId: asString(d.WorkStreamId),
    requiredCapacityUnits:
      typeof d.RequiredCapacityUnits === "number" ? d.RequiredCapacityUnits : null,
    allowedPresences: asStringArray(d.AllowedPresences),
    requiredSkills: Array.isArray(d.RequiredSkills)
      ? d.RequiredSkills.map(
          (s) =>
            asString((s as Record<string, unknown>)?.CharacteristicName) ||
            asString((s as Record<string, unknown>)?.CharacteristicId) ||
            ""
        ).filter(Boolean)
      : [],
    capacityProfiles: asStringArray(d.CapacityProfiles),
    reservationType: asString(d.ReservationType),
    queueAssignedOn: asString(d.QueueAssignedOn),
  };
}

function parseAssignment(
  payload: string | null,
  result: string | null,
  outcome: string | null
): AssignmentDetails | null {
  const root = safeParse(payload) as Record<string, unknown> | null;
  if (!root) return null;

  const method = asString(root["omnichannel.assignment.method"]);
  const statusRaw = safeParse(asString(root["omnichannel.assignment.status"]));
  if (!method && !statusRaw) return null;

  const status = (statusRaw ?? {}) as Record<string, unknown>;
  const rules = safeParse(result) as Record<string, unknown> | null;

  return {
    method,
    reason: asString(status.Reason) ?? outcome,
    isAgentAssigned: status.IsAgentAssigned === true,
    rulesExecuted: rules
      ? Object.fromEntries(Object.entries(rules).map(([k, v]) => [k, asString(v)]))
      : null,
    agent: parseAssignedAgent(status.AgentDetails),
  };
}

/** Skills arrive either as plain strings or as characteristic objects depending on
 *  how the agent was matched, so both shapes are flattened to names. */
function parseAssignedAgent(raw: unknown): AssignedAgent | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;

  const skills = Array.isArray(d.Skills)
    ? d.Skills.map((s) => {
        if (typeof s === "string") return s;
        const o = (s ?? {}) as Record<string, unknown>;
        return (
          asString(o.CharacteristicName) ||
          asString(o.Name) ||
          asString(o.CharacteristicId) ||
          ""
        );
      }).filter(Boolean)
    : [];

  return {
    agentId: asString(d.AgentId),
    skills,
    presence: asString(d.BasePresence),
    availableCapacityUnits:
      typeof d.AvailableCapacityUnits === "number" ? d.AvailableCapacityUnits : null,
    capacityProfiles: asStringArray(d.CapacityProfiles),
    activeSessionCount:
      typeof d.ActiveSessionCount === "number" ? d.ActiveSessionCount : null,
  };
}

/** Trace payloads are machine written and occasionally double encoded, so a parse
 *  failure is expected rather than exceptional: the raw text stays available in the
 *  payload tab either way. */
function safeParse(text: string | null | undefined): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function asString(value: unknown): string | null {
  if (typeof value === "string") return value.length > 0 ? value : null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((v) => String(v)) : [];
}