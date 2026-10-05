/** The left column: every routed record or conversation in the window. */

import * as React from "react";
import {
  Badge,
  Body1Strong,
  Button,
  Caption1,
  SearchBox,
  Spinner,
  Text,
  makeStyles,
  shorthands,
  tokens,
} from "@fluentui/react-components";
import { Outcome, RoutedSubject } from "../types";
import { elapsedLabel, stamp } from "./formatting";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    width: "360px",
    minWidth: "360px",
    height: "100%",
    ...shorthands.borderRight("1px", "solid", tokens.colorNeutralStroke2),
    backgroundColor: tokens.colorNeutralBackground1,
  },
  search: {
    display: "flex",
    flexShrink: 0,
    alignItems: "center",
    columnGap: tokens.spacingHorizontalXS,
    ...shorthands.padding(tokens.spacingVerticalM, tokens.spacingHorizontalM),
  },
  header: {
    display: "flex",
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "space-between",
    ...shorthands.padding(tokens.spacingVerticalXS, tokens.spacingHorizontalM),
    ...shorthands.borderBottom("1px", "solid", tokens.colorNeutralStroke2),
    color: tokens.colorNeutralForeground3,
  },
  list: {
    // The rows stack from the top: without this the browser distributes the free
    // space and a single result floats in the middle of an empty column.
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
    justifyContent: "flex-start",
    flexGrow: 1,
    overflowY: "auto",
  },
  more: {
    display: "flex",
    justifyContent: "center",
    ...shorthands.padding(tokens.spacingVerticalM, tokens.spacingHorizontalM),
  },
  item: {
    display: "flex",
    flexShrink: 0,
    flexDirection: "column",
    rowGap: tokens.spacingVerticalXXS,
    ...shorthands.padding(tokens.spacingVerticalS, tokens.spacingHorizontalM),
    ...shorthands.borderLeft("3px", "solid", "transparent"),
    cursor: "pointer",
    ":hover": { backgroundColor: tokens.colorNeutralBackground1Hover },
  },
  itemSelected: {
    backgroundColor: tokens.colorNeutralBackground1Selected,
    ...shorthands.borderLeft("3px", "solid", tokens.colorBrandStroke1),
  },
  titleRow: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    columnGap: tokens.spacingHorizontalS,
  },
  title: {
    ...shorthands.overflow("hidden"),
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  badges: {
    display: "flex",
    flexWrap: "wrap",
    columnGap: tokens.spacingHorizontalXS,
    rowGap: tokens.spacingVerticalXXS,
    marginTop: tokens.spacingVerticalXXS,
  },
  empty: {
    ...shorthands.padding(tokens.spacingVerticalXXL, tokens.spacingHorizontalL),
    textAlign: "center",
    color: tokens.colorNeutralForeground3,
  },
  centre: {
    display: "flex",
    justifyContent: "center",
    ...shorthands.padding(tokens.spacingVerticalXXL, "0"),
  },
});

/** Outcome colour carries meaning, so it also differs in weight and wording:
 *  colour alone would fail anyone who cannot separate the hues. */
function outcomeAppearance(outcome: Outcome): {
  color: "informative" | "warning" | "danger" | "success" | "important";
} {
  switch (outcome.kind) {
    case "inConversation":
      return { color: "success" };
    case "waitingAssignment":
      return { color: "warning" };
    case "waitingAcceptance":
      return { color: "informative" };
    case "abandoned":
      return { color: "danger" };
    // Closed is the quiet outcome, but subtle rendered it almost invisible on a
    // light row: important keeps it quiet in hue and still readable.
    case "closed":
      return { color: "important" };
    default:
      return { color: "informative" };
  }
}

export interface SubjectListProps {
  subjects: RoutedSubject[];
  selectedKey: string | null;
  loading: boolean;
  search: string;
  onSearchChange: (value: string) => void;
  /** Searching hits the server, so it happens on demand, not while typing. */
  onSearch: () => void;
  onSelect: (subject: RoutedSubject) => void;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}

export const SubjectList: React.FC<SubjectListProps> = ({
  subjects,
  selectedKey,
  loading,
  search,
  onSearchChange,
  onSearch,
  onSelect,
  hasMore,
  loadingMore,
  onLoadMore,
}) => {
  const styles = useStyles();

  return (
    <div className={styles.root}>
      <div className={styles.search}>
        <SearchBox
          placeholder="Subject or id"
          value={search}
          onChange={(_, data) => onSearchChange(data.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSearch();
          }}
          appearance="filled-darker"
          style={{ flexGrow: 1, minWidth: 0 }}
        />
        <Button appearance="primary" size="small" onClick={onSearch}>
          Search
        </Button>
      </div>
      <div className={styles.header}>
        <Caption1>
          {subjects.length} routed{hasMore ? ", more available" : ""}
        </Caption1>
        <Caption1>Newest first</Caption1>
      </div>
      <div className={styles.list}>
        {loading && (
          <div className={styles.centre}>
            <Spinner size="tiny" label="Loading" />
          </div>
        )}

        {!loading && subjects.length === 0 && (
          <div className={styles.empty}>
            <Body1Strong as="p">Nothing routed in this window</Body1Strong>
            <Caption1 as="p">
              Either nothing was routed, or it falls outside the selected range.
            </Caption1>
          </div>
        )}

        {!loading &&
          subjects.map((subject) => {
            const selected = subject.key === selectedKey;
            const { color } = outcomeAppearance(subject.outcome);
            const attempts = subject.items.length;
            const latest = subject.latest;

            return (
              <div
                key={subject.key}
                role="button"
                tabIndex={0}
                aria-pressed={selected}
                className={
                  selected ? `${styles.item} ${styles.itemSelected}` : styles.item
                }
                onClick={() => onSelect(subject)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(subject);
                  }
                }}
              >
                <div className={styles.titleRow}>
                  <Body1Strong className={styles.title}>{subject.title}</Body1Strong>
                  <Caption1>{stamp(latest.createdOnLabel)}</Caption1>
                </div>
                <Caption1>
                  {subject.logicalName ?? "conversation"} ·{" "}
                  {attempts === 1 ? "1 attempt" : `${attempts} attempts`}
                </Caption1>
                <div className={styles.badges}>
                  <Badge appearance="outline" color={color} size="small">
                    {subject.outcome.label}
                  </Badge>
                  {subject.outcome.kind === "waitingAssignment" && (
                    <Badge appearance="outline" color="informative" size="small">
                      {elapsedLabel(latest.firstWaitStartedOn, latest.closedOn)}
                    </Badge>
                  )}
                </div>
              </div>
            );
          })}

        {!loading && hasMore && (
          <div className={styles.more}>
            <Button appearance="secondary" size="small" onClick={onLoadMore} disabled={loadingMore}>
              {loadingMore ? "Loading" : "Load more"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};