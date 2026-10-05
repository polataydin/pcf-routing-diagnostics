/** The whole control: a window picker, a list of routed work, and the detail of
 *  whatever is selected. */

import * as React from "react";
import {
  Button,
  FluentProvider,
  Select,
  Subtitle1,
  Caption1,
  Tab,
  TabList,
  Spinner,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  makeStyles,
  shorthands,
  tokens,
  webLightTheme,
  webDarkTheme,
} from "@fluentui/react-components";
import {
  DiagnosticRequest,
  LiveWorkItem,
  QueueItem,
  RoutedSubject,
  Session,
  Stage,
} from "../types";
import {
  fetchAgentSkills,
  fetchLiveWorkItems,
  fetchMoreLiveWorkItems,
  fetchNames,
  fetchQueueItems,
  fetchSessions,
  groupByRoutedSubject,
} from "../services/dataverse";
import { DiagnosticsResult, loadDiagnostics } from "../services/diagnostics";
import { SubjectList } from "./SubjectList";
import { SubjectDetail } from "./SubjectDetail";
import { LabelMap, StagePanel, isGuid } from "./StagePanel";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    // The host gives the control whatever box the page has; without an explicit
    // width the flex children collapse to their content and leave the page empty.
    width: "100%",
    height: "100%",
    minHeight: "640px",
    backgroundColor: tokens.colorNeutralBackground2,
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    columnGap: tokens.spacingHorizontalM,
    ...shorthands.padding(tokens.spacingVerticalM, tokens.spacingHorizontalL),
    ...shorthands.borderBottom("1px", "solid", tokens.colorNeutralStroke2),
    backgroundColor: tokens.colorNeutralBackground1,
  },
  headerText: { display: "flex", flexDirection: "column" },
  headerTools: { display: "flex", alignItems: "center", columnGap: tokens.spacingHorizontalS },
  version: { color: tokens.colorNeutralForeground3 },
  body: { display: "flex", flexGrow: 1, minHeight: 0, width: "100%" },
  main: { display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0, width: "100%" },
  tabs: {
    ...shorthands.padding("0", tokens.spacingHorizontalL),
    ...shorthands.borderBottom("1px", "solid", tokens.colorNeutralStroke2),
    backgroundColor: tokens.colorNeutralBackground1,
  },
  scroll: { flexGrow: 1, overflowY: "auto", width: "100%" },
  placeholder: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    rowGap: tokens.spacingVerticalS,
    height: "100%",
    color: tokens.colorNeutralForeground3,
  },
  banner: { ...shorthands.margin(tokens.spacingVerticalM, tokens.spacingHorizontalL) },
});

/** hours === null means no time filter at all; the list is then paged instead. */
const WINDOWS: { key: string; label: string; hours: number | null }[] = [
  { key: "1", label: "Last hour", hours: 1 },
  { key: "24", label: "Last 24 hours", hours: 24 },
  { key: "72", label: "Last 3 days", hours: 72 },
  { key: "168", label: "Last 7 days", hours: 168 },
  { key: "all", label: "All time", hours: null },
];

const PAGE_SIZE = 250;

/** Shown in the header so a deployed build can be identified at a glance. Kept in
 *  step with the version in ControlManifest.Input.xml by hand. */
const VERSION = "1.0.7";

export interface AppProps {
  webAPI: ComponentFramework.WebApi;
  navigation: ComponentFramework.Navigation;
  isDarkTheme: boolean;
}

export const App: React.FC<AppProps> = ({ webAPI, navigation, isDarkTheme }) => {
  const styles = useStyles();

  // The host hands over a fresh webAPI object on every updateView, and it calls
  // updateView several times while the page settles. Keying effects on it would
  // make each of those a reload, so the current object is held in a ref and the
  // effects depend on what the person actually changed instead.
  const api = React.useRef(webAPI);
  api.current = webAPI;

  const [windowKey, setWindowKey] = React.useState("all");
  // What is typed and what has been searched are separate: a keystroke must not
  // reach the server, only the search button or Enter does.
  const [searchDraft, setSearchDraft] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [subjects, setSubjects] = React.useState<RoutedSubject[]>([]);
  const [sessions, setSessions] = React.useState<Session[]>([]);
  const [queueItems, setQueueItems] = React.useState<QueueItem[]>([]);
  const [selectedKey, setSelectedKey] = React.useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState("lifecycle");

  const [loadingList, setLoadingList] = React.useState(true);
  const [loadingTrace, setLoadingTrace] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [request, setRequest] = React.useState<DiagnosticRequest | null>(null);
  const [stages, setStages] = React.useState<Stage[]>([]);

  // Traces log ids; the names behind them are read once and kept for the session,
  // because the same queues, skills and agents come back on every trace.
  const labelCache = React.useRef<Map<string, string>>(new Map());
  const [labels, setLabels] = React.useState<LabelMap>(new Map());

  const [reloadToken, setReloadToken] = React.useState(0);
  const [traceToken, setTraceToken] = React.useState(0);

  const hours = React.useMemo(
    () => WINDOWS.find((w) => w.key === windowKey)?.hours ?? null,
    [windowKey]
  );

  // Every page read so far. Grouping runs over the whole accumulation, so an
  // attempt arriving on a later page joins the group its record already has
  // instead of starting a second one.
  const [items, setItems] = React.useState<LiveWorkItem[]>([]);
  const [nextLink, setNextLink] = React.useState<string | null>(null);
  const [loadingMore, setLoadingMore] = React.useState(false);

  // Sessions are what say whether work was ever offered. They are read once per
  // item and kept, so loading another page costs only the new page's sessions.
  const sessionsByItem = React.useRef(new Map<string, Session[]>());

  const regroup = React.useCallback(
    async (all: LiveWorkItem[], fresh: LiveWorkItem[]): Promise<void> => {
      const unknown = fresh
        .map((i) => i.activityid)
        .filter((id) => !sessionsByItem.current.has(id));

      if (unknown.length > 0) {
        for (const id of unknown) sessionsByItem.current.set(id, []);
        const loaded = await fetchSessions(api.current, unknown);
        for (const session of loaded) {
          if (!session.liveWorkItemId) continue;
          const bucket = sessionsByItem.current.get(session.liveWorkItemId);
          if (bucket) bucket.push(session);
          else sessionsByItem.current.set(session.liveWorkItemId, [session]);
        }
      }

      setSubjects(groupByRoutedSubject(all, sessionsByItem.current));
    },
    []
  );

  React.useEffect(() => {
    let cancelled = false;

    async function run(): Promise<void> {
      setLoadingList(true);
      setError(null);
      try {
        const since = hours === null ? null : new Date(Date.now() - hours * 3600_000).toISOString();
        const page = await fetchLiveWorkItems(api.current, since, search || null, PAGE_SIZE);
        if (cancelled) return;
        sessionsByItem.current = new Map<string, Session[]>();
        setItems(page.items);
        setNextLink(page.nextLink);
        await regroup(page.items, page.items);
      } catch (e) {
        if (!cancelled) setError(describeError(e));
      } finally {
        if (!cancelled) setLoadingList(false);
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [hours, search, reloadToken, regroup]);

  const handleLoadMore = React.useCallback(() => {
    if (!nextLink || loadingMore) return;

    async function run(link: string): Promise<void> {
      setLoadingMore(true);
      try {
        const page = await fetchMoreLiveWorkItems(api.current, link, PAGE_SIZE);
        const all = [...items, ...page.items];
        setItems(all);
        setNextLink(page.nextLink);
        await regroup(all, page.items);
      } catch (e) {
        setError(describeError(e));
      } finally {
        setLoadingMore(false);
      }
    }

    void run(nextLink);
  }, [nextLink, loadingMore, items, regroup]);

  const handleSearch = React.useCallback(() => {
    setSearch(searchDraft.trim());
  }, [searchDraft]);

  /** Clearing the box is a search in its own right: the list goes back to the
   *  whole window rather than sitting on the last result. */
  const handleSearchChange = React.useCallback((value: string) => {
    setSearchDraft(value);
    if (value === "") setSearch("");
  }, []);

  const selected = React.useMemo(
    () => subjects.find((s) => s.key === selectedKey) ?? null,
    [subjects, selectedKey]
  );

  // Selecting a subject pulls only what that subject needs, so the list stays cheap.
  React.useEffect(() => {
    if (!selected) {
      setSessions([]);
      setQueueItems([]);
      return;
    }
    let cancelled = false;

    async function run(subject: RoutedSubject): Promise<void> {
      try {
        const itemIds = subject.items.map((i) => i.activityid);
        const objectIds = [subject.recordId, ...itemIds].filter(
          (id): id is string => Boolean(id)
        );
        const [loadedSessions, loadedQueueItems] = await Promise.all([
          fetchSessions(api.current, itemIds),
          fetchQueueItems(api.current, objectIds),
        ]);
        if (cancelled) return;
        setSessions(loadedSessions);
        setQueueItems(loadedQueueItems);
      } catch (e) {
        if (!cancelled) setError(describeError(e));
      }
    }

    void run(selected);
    return () => {
      cancelled = true;
    };
  }, [selected]);

  // Every trace costs a request row and a flow run against Application Insights,
  // so each attempt is queried at most once and the answer is kept. Walking back
  // and forth between attempts then costs nothing; Re-run asks again on purpose.
  const traceCache = React.useRef(new Map<string, DiagnosticsResult>());
  const inFlight = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (tab !== "trace") return;
    if (!selectedItemId || !selected) return;

    const cached = traceCache.current.get(selectedItemId);
    if (cached) {
      setRequest(cached.request);
      setStages(cached.stages);
      setLoadingTrace(false);
      return;
    }

    if (inFlight.current === selectedItemId) return;

    const item = selected.items.find((i) => i.activityid === selectedItemId);
    const conversationId = item?.conversationId ?? item?.activityid;
    if (!item || !conversationId) return;

    const attemptId = selectedItemId;
    inFlight.current = attemptId;

    async function run(): Promise<void> {
      setLoadingTrace(true);
      setRequest(null);
      setStages([]);
      try {
        const windowStart = new Date(Date.parse(item!.createdOn ?? "") - 5 * 60_000);
        const windowEnd = new Date(
          (item!.closedOn ? Date.parse(item!.closedOn) : Date.now()) + 5 * 60_000
        );
        const result = await loadDiagnostics(
          api.current,
          conversationId!,
          windowStart,
          windowEnd
        );
        const stages = await withAgentSkills(api.current, result.stages);
        traceCache.current.set(attemptId, { request: result.request, stages });
        setRequest(result.request);
        setStages(stages);
        await resolveLabels(api.current, stages, labelCache.current);
        setLabels(new Map(labelCache.current));
      } catch (e) {
        setError(describeError(e));
      } finally {
        inFlight.current = null;
        setLoadingTrace(false);
      }
    }

    void run();
  }, [selected, selectedItemId, tab, traceToken]);

  /** Asks Application Insights again for the attempt on screen. */
  const handleRerunTrace = React.useCallback(() => {
    if (!selectedItemId) return;
    traceCache.current.delete(selectedItemId);
    setRequest(null);
    setStages([]);
    setTraceToken((t) => t + 1);
  }, [selectedItemId]);

  // The newest attempt is pre-selected so the Trace tab is reachable straight away.
  const handleSelectSubject = React.useCallback((subject: RoutedSubject) => {
    setSelectedKey(subject.key);
    setSelectedItemId(subject.latest.activityid);
    setRequest(null);
    setStages([]);
    setTab("lifecycle");
  }, []);

  // Changing the window rebuilds the list, so anything selected from the old one
  // is meaningless: holding on to it leaves the Trace tab reading a trace that
  // belongs to a record no longer shown.
  React.useEffect(() => {
    setSelectedKey(null);
    setSelectedItemId(null);
    setRequest(null);
    setStages([]);
    setTab("lifecycle");
  }, [hours]);

  // An empty right pane says nothing useful, so the first record opens on load.
  React.useEffect(() => {
    if (loadingList) return;
    if (selected || subjects.length === 0) return;
    handleSelectSubject(subjects[0]);
  }, [loadingList, selected, subjects, handleSelectSubject]);

  const handleSelectItem = React.useCallback((item: LiveWorkItem) => {
    setSelectedItemId(item.activityid);
    setTab("trace");
  }, []);

  /** Opens whatever was routed: a case, an email, a custom row. */
  const handleOpenRecord = React.useCallback(
    (logicalName: string, id: string) => {
      void navigation.openForm({ entityName: logicalName, entityId: id, openInNewWindow: true });
    },
    [navigation]
  );

  return (
    <FluentProvider theme={isDarkTheme ? webDarkTheme : webLightTheme} className={styles.root}>
      <header className={styles.header}>
        <div className={styles.headerText}>
          <Subtitle1>Routing diagnostics</Subtitle1>
          <Caption1>
            Unified routing lifecycle across attempts, sessions, queues and traces
          </Caption1>
        </div>
        <div className={styles.headerTools}>
          <Caption1 className={styles.version}>v{VERSION}</Caption1>
          <Select
            value={windowKey}
            onChange={(_, d) => setWindowKey(d.value)}
            style={{ minWidth: "160px" }}
            aria-label="Time window"
          >
            {WINDOWS.map((w) => (
              <option key={w.key} value={w.key}>
                {w.label}
              </option>
            ))}
          </Select>
          <Button
            appearance="subtle"
            aria-label="Refresh"
            onClick={() => setReloadToken((t) => t + 1)}
          >
            Refresh
          </Button>
        </div>
      </header>

      {error && (
        <MessageBar intent="error" className={styles.banner}>
          <MessageBarBody>
            <MessageBarTitle>Could not read routing data</MessageBarTitle>
            {error}
          </MessageBarBody>
        </MessageBar>
      )}

      <div className={styles.body}>
        <SubjectList
          subjects={subjects}
          selectedKey={selectedKey}
          loading={loadingList}
          search={searchDraft}
          onSearchChange={handleSearchChange}
          onSearch={handleSearch}
          onSelect={handleSelectSubject}
          hasMore={nextLink !== null}
          loadingMore={loadingMore}
          onLoadMore={handleLoadMore}
        />

        <div className={styles.main}>
          {!selected && (
            <div className={styles.placeholder}>
              {loadingList ? (
                <Spinner label="Loading routed work" />
              ) : (
                <>
                  <Subtitle1>Select a record to see how it was routed</Subtitle1>
                  <Caption1>
                    Each entry groups every routing attempt made for that record.
                  </Caption1>
                </>
              )}
            </div>
          )}

          {selected && (
            <>
              <div className={styles.tabs}>
                <TabList selectedValue={tab} onTabSelect={(_, d) => setTab(String(d.value))}>
                  <Tab value="lifecycle">Lifecycle</Tab>
                  <Tab value="trace" disabled={!selectedItemId}>
                    Trace
                  </Tab>
                </TabList>
              </div>
              <div className={styles.scroll}>
                {tab === "lifecycle" && (
                  <SubjectDetail
                    subject={selected}
                    sessions={sessions}
                    queueItems={queueItems}
                    selectedItemId={selectedItemId}
                    onSelectItem={handleSelectItem}
                    onOpenRecord={handleOpenRecord}
                  />
                )}
                {tab === "trace" && (
                  <StagePanel
                    loading={loadingTrace}
                    request={request}
                    stages={stages}
                    labels={labels}
                    onOpenRecord={handleOpenRecord}
                    onRerun={handleRerunTrace}
                  />
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </FluentProvider>
  );
};

/** The assignment trace names the agent it picked but logs an empty skill list, so
 *  the skills are read from Dataverse and folded in before the stages are cached.
 *  A failure here is not worth failing the trace over: the panel simply says none
 *  were recorded, as it did before. */
async function withAgentSkills(
  webAPI: ComponentFramework.WebApi,
  stages: Stage[]
): Promise<Stage[]> {
  const ids = Array.from(
    new Set(
      stages
        .map((stage) => stage.assignment?.agent)
        .filter((agent) => agent?.agentId && agent.skills.length === 0)
        .map((agent) => agent!.agentId!)
    )
  );
  if (ids.length === 0) return stages;

  const skillsById = new Map<string, string[]>();
  for (const id of ids) {
    try {
      skillsById.set(id, await fetchAgentSkills(webAPI, id));
    } catch {
      skillsById.set(id, []);
    }
  }

  return stages.map((stage) => {
    const agent = stage.assignment?.agent;
    if (!agent?.agentId) return stage;
    const skills = skillsById.get(agent.agentId);
    if (!skills || skills.length === 0) return stage;
    return {
      ...stage,
      assignment: { ...stage.assignment!, agent: { ...agent, skills } },
    };
  });
}

/** Which table each id in a trace belongs to. Application Insights logs bare ids,
 *  so this is the only thing that says a given guid is a queue rather than a skill. */
function collectLookups(stages: Stage[]): Map<string, Set<string>> {
  const byEntity = new Map<string, Set<string>>();

  const add = (entity: string, id: string | null | undefined): void => {
    if (!id || !isGuid(id)) return;
    const clean = id.replace(/[{}]/g, "");
    const set = byEntity.get(entity) ?? new Set<string>();
    set.add(clean);
    byEntity.set(entity, set);
  };

  for (const stage of stages) {
    const details = stage.workItemDetails;
    if (details) {
      add("queue", details.queueId);
      add("msdyn_liveworkstream", details.workstreamId);
      details.requiredSkills.forEach((skill) => add("characteristic", skill));
    }

    const assignment = stage.assignment;
    if (assignment) {
      add("systemuser", assignment.agent?.agentId);
      assignment.agent?.skills.forEach((skill) => add("characteristic", skill));
      if (assignment.rulesExecuted) {
        for (const [key, value] of Object.entries(assignment.rulesExecuted)) {
          if (key.toLowerCase().includes("ruleset")) {
            add("msdyn_decisionruleset", value);
          }
        }
      }
    }
  }

  return byEntity;
}

/** Fills the name cache for everything this trace references. A table that refuses
 *  the read leaves its ids raw rather than failing the trace. */
async function resolveLabels(
  webAPI: ComponentFramework.WebApi,
  stages: Stage[],
  cache: Map<string, string>
): Promise<void> {
  const byEntity = collectLookups(stages);

  for (const [entity, ids] of byEntity) {
    const missing = Array.from(ids).filter((id) => !cache.has(id.toLowerCase()));
    if (missing.length === 0) continue;
    try {
      const names = await fetchNames(webAPI, entity, missing);
      names.forEach((name, id) => cache.set(id, name));
    } catch {
      // The id stays on screen as written, which is still usable.
    }
  }
}

/** Dataverse errors are the common failure here, and their message names the table
 *  that was refused, which is exactly what an admin needs. */
function describeError(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) {
    return String((e as { message: unknown }).message);
  }
  return "Unknown error";
}