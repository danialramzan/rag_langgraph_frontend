import { v4 as uuidv4 } from "uuid";
import { Fragment, ReactNode, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import {
  type StudyResultSnapshot as PersistedStudyResultSnapshot,
  type TrialMatch,
  useStreamContext,
} from "@/providers/Stream";
import { useState, FormEvent } from "react";
import { Button } from "../ui/button";
import { Checkpoint, Message } from "@langchain/langgraph-sdk";
import { AssistantMessage, AssistantMessageLoading } from "./messages/ai";
import { HumanMessage } from "./messages/human";
import {
  DO_NOT_RENDER_ID_PREFIX,
  ensureToolCallsHaveResponses,
} from "@/lib/ensure-tool-responses";
import { LangGraphLogoSVG } from "../icons/langgraph";
import { TooltipIconButton } from "./tooltip-icon-button";
import {
  ArrowDown,
  ChevronDown,
  LoaderCircle,
  Maximize2,
  PanelRightOpen,
  PanelRightClose,
  SquarePen,
  XIcon,
  Plus,
} from "lucide-react";
import { useQueryState, parseAsBoolean } from "nuqs";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";
import ThreadHistory from "./history";
import { toast } from "sonner";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { Label } from "../ui/label";
import { Switch } from "../ui/switch";
import { GitHubSVG } from "../icons/github";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";
import { useFileUpload } from "@/hooks/use-file-upload";
import { ContentBlocksPreview } from "./ContentBlocksPreview";
import { getContentString } from "./utils";
import {
  useArtifactOpen,
  ArtifactContent,
  ArtifactTitle,
  useArtifactContext,
} from "./artifact";
import { LocationRequest } from "./location-request";

function StickyToBottomContent(props: {
  content: ReactNode;
  footer?: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  const context = useStickToBottomContext();
  return (
    <div
      ref={context.scrollRef}
      style={{ width: "100%", height: "100%" }}
      className={props.className}
    >
      <div
        ref={context.contentRef}
        className={props.contentClassName}
      >
        {props.content}
      </div>

      {props.footer}
    </div>
  );
}

function ScrollToBottom(props: { className?: string }) {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();

  if (isAtBottom) return null;
  return (
    <Button
      variant="outline"
      className={props.className}
      onClick={() => scrollToBottom()}
    >
      <ArrowDown className="h-4 w-4" />
      <span>Scroll to bottom</span>
    </Button>
  );
}

function SuggestedOptions({
  onOpenLocationEditor,
}: {
  onOpenLocationEditor: () => void;
}) {
  const stream = useStreamContext();
  const slots = stream.values.slots;
  const hasLocation =
    typeof stream.values.user_location?.latitude === "number" ||
    typeof slots?.latitude === "number" ||
    (typeof slots?.location === "object" &&
      typeof slots.location?.latitude === "number" &&
      typeof slots.location?.longitude === "number") ||
    (typeof slots?.location === "string" && slots.location.trim().length > 0);
  const isLocationCardActive =
    stream.values.request_user_location === true && !hasLocation;
  const options = stream.values.suggested_options ?? [];

  if (isLocationCardActive || !options.length) return null;

  const handleSelect = (option: string) => {
    if (stream.isLoading) return;
    const normalizedOption = option.toLowerCase();

    if (
      normalizedOption.includes("new search") ||
      normalizedOption.includes("new study search")
    ) {
      const message: Message = {
        id: uuidv4(),
        type: "human",
        content: option,
      };
      const toolMessages = ensureToolCallsHaveResponses(stream.messages);

      stream.submit(
        { messages: [...toolMessages, message], slots: {} },
        {
          streamMode: ["values"],
          streamSubgraphs: true,
          streamResumable: true,
          optimisticValues: (previous) => ({
            ...previous,
            request_user_location: false,
            location_confirmation_required: false,
            slots: {},
            trial_matches: [],
            trial_count: null,
            messages: [...(previous.messages ?? []), ...toolMessages, message],
          }),
        },
      );
      return;
    }

    const shouldOpenLocationEditor =
      normalizedOption.includes("adjust location") ||
      normalizedOption.includes("change location") ||
      normalizedOption.includes("add location") ||
      normalizedOption.includes("more specific location") ||
      normalizedOption.includes("search for a city") ||
      normalizedOption.includes("use browser location");

    if (shouldOpenLocationEditor) {
      onOpenLocationEditor();
      return;
    }

    const message: Message = {
      id: uuidv4(),
      type: "human",
      content: option,
    };

    const toolMessages = ensureToolCallsHaveResponses(stream.messages);

    stream.submit(
      { messages: [...toolMessages, message] },
      {
        streamMode: ["values"],
        streamSubgraphs: true,
        streamResumable: true,
        optimisticValues: (previous) => ({
          ...previous,
          trial_matches: [],
          trial_count: null,
          messages: [...(previous.messages ?? []), ...toolMessages, message],
        }),
      },
    );
  };

  return (
    <details className="group mx-auto w-full max-w-3xl rounded-2xl border bg-white shadow-xs">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
        <span>Suggestions</span>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-xs">
            {options.length}
          </span>
          <ChevronDown className="text-muted-foreground h-4 w-4 transition-transform group-open:rotate-180" />
        </div>
      </summary>
      <div className="flex flex-wrap gap-2 border-t px-4 py-3">
        {options.map((option) => (
          <Button
            key={option}
            type="button"
            variant="outline"
            size="sm"
            onClick={() => handleSelect(option)}
            disabled={stream.isLoading}
            className="rounded-full"
          >
            {option}
          </Button>
        ))}
      </div>
    </details>
  );
}

function UserInfoSummary() {
  const stream = useStreamContext();
  const slots = stream.values.slots ?? {};
  const userLocation = stream.values.user_location;
  const condition = Array.isArray(slots.condition)
    ? slots.condition.join(", ")
    : typeof slots.condition === "string"
      ? slots.condition
      : undefined;
  const location =
    (typeof slots.location === "object" &&
      (slots.location.label ||
        `${slots.location.latitude.toFixed(4)}, ${slots.location.longitude.toFixed(4)}`)) ||
    userLocation?.label ||
    (typeof slots.latitude === "number" && typeof slots.longitude === "number"
      ? `${slots.latitude.toFixed(4)}, ${slots.longitude.toFixed(4)}`
      : slots.location);

  const items = [
    condition && { label: "Condition", value: condition },
    typeof slots.age === "number" && { label: "Age", value: `${slots.age}` },
    slots.sex && { label: "Sex", value: slots.sex },
    location && { label: "Location", value: location },
    typeof slots.radius_miles === "number" && {
      label: "Radius",
      value: `${slots.radius_miles} miles`,
    },
  ].filter(Boolean) as Array<{ label: string; value: string }>;

  if (!items.length) return null;

  return (
    <details className="group mx-auto w-full max-w-3xl rounded-2xl border bg-white shadow-xs">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
        <span>What I know so far</span>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-xs">{items.length}</span>
          <ChevronDown className="text-muted-foreground h-4 w-4 transition-transform group-open:rotate-180" />
        </div>
      </summary>
      <div className="flex flex-wrap gap-2 border-t px-4 py-3">
        {items.map((item) => (
          <div
            key={item.label}
            className="rounded-full bg-slate-100 px-3 py-1 text-xs"
          >
            <span className="text-muted-foreground">{item.label}: </span>
            <span className="font-medium">{item.value}</span>
          </div>
        ))}
      </div>
    </details>
  );
}

function getStudyKey(match: TrialMatch, index?: number) {
  return match.id || `${match.title || "study"}-${index ?? 0}`;
}

function formatEstimatedSiteDistance(match: TrialMatch) {
  if (typeof match.estimated_site_distance_miles !== "number") return null;
  return `Approx. ${match.estimated_site_distance_miles.toFixed(1)} miles from listed site`;
}

function getVisibleStudyDetails(match: TrialMatch) {
  const estimatedSiteDistance = formatEstimatedSiteDistance(match);
  return [
    match.id && ["NCT ID", match.id],
    match.status && ["Status", match.status],
    match.phase && ["Phase", match.phase],
    match.condition && ["Condition", match.condition],
    match.location && ["Closest listed site", match.location],
    match.location_status && ["Closest site status", match.location_status],
    estimatedSiteDistance && [
      "Approximate distance",
      `${estimatedSiteDistance}. This may not be the exact facility address or travel-route distance.`,
    ],
    match.contact_name && ["Local site contact", match.contact_name],
    match.contact_phone && ["Local contact phone", match.contact_phone],
    match.contact_email && ["Local contact email", match.contact_email],
    match.study_contact_name && ["Study contact", match.study_contact_name],
    match.study_contact_phone && [
      "Study contact phone",
      match.study_contact_phone,
    ],
    match.study_contact_email && [
      "Study contact email",
      match.study_contact_email,
    ],
    match.study_official_name && ["Study official", match.study_official_name],
    match.study_official_phone && [
      "Study official phone",
      match.study_official_phone,
    ],
    match.study_official_email && [
      "Study official email",
      match.study_official_email,
    ],
    match.sponsor && ["Sponsor", match.sponsor],
    match.sex && ["Sex", match.sex],
    (match.minimum_age || match.maximum_age) && [
      "Age range",
      [match.minimum_age, match.maximum_age].filter(Boolean).join(" – "),
    ],
    match.outside_radius && [
      "Radius note",
      "This study is outside the selected radius but was included because there were not enough closer matches.",
    ],
  ].filter(Boolean) as Array<[string, string]>;
}

function getRawStudyDetails(match: TrialMatch) {
  return Object.entries(match).filter(
    ([key, value]) =>
      key !== "raw_json" &&
      value !== undefined &&
      value !== null &&
      value !== "",
  );
}

function formatJsonForDisplay(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

type PrettyStudySection = {
  title: string;
  fields?: Array<[string, string]>;
  paragraphs?: string[];
  items?: string[];
  groups?: Array<{
    title: string;
    items: string[];
  }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function compactText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return String(value);
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length ? normalized : undefined;
}

function joinValues(values: Array<unknown>, separator = ", ") {
  const normalized = values
    .map((value) => compactText(value))
    .filter(Boolean) as string[];
  return normalized.length ? normalized.join(separator) : undefined;
}

function getNested(
  record: Record<string, unknown>,
  ...path: string[]
): unknown {
  let current: unknown = record;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

function dateStructText(module: Record<string, unknown>, key: string) {
  const value = getNested(module, key, "date") ?? module[key];
  return compactText(value);
}

function field(label: string, value: unknown): [string, string] | undefined {
  const text = compactText(value);
  return text ? [label, text] : undefined;
}

function sectionHasContent(section: PrettyStudySection) {
  return Boolean(
    section.fields?.length ||
    section.paragraphs?.length ||
    section.items?.length ||
    section.groups?.some((group) => group.items.length),
  );
}

function getPrettyStudySections(match: TrialMatch): PrettyStudySection[] {
  const raw = asRecord(match.raw_json);
  const protocol = asRecord(raw.protocolSection);
  const identification = asRecord(protocol.identificationModule);
  const status = asRecord(protocol.statusModule);
  const description = asRecord(protocol.descriptionModule);
  const design = asRecord(protocol.designModule);
  const designInfo = asRecord(design.designInfo);
  const enrollmentInfo = asRecord(design.enrollmentInfo);
  const eligibility = asRecord(protocol.eligibilityModule);
  const contacts = asRecord(protocol.contactsLocationsModule);
  const armsInterventions = asRecord(protocol.armsInterventionsModule);
  const outcomes = asRecord(protocol.outcomesModule);
  const sponsors = asRecord(protocol.sponsorCollaboratorsModule);

  const phases = asArray(design.phases)
    .map((item) => compactText(item))
    .filter(Boolean)
    .join(", ");
  const conditions = asArray(asRecord(protocol.conditionsModule).conditions)
    .map((item) => compactText(item))
    .filter(Boolean)
    .join(", ");

  const overview: PrettyStudySection = {
    title: "Overview",
    fields: [
      field("NCT ID", identification.nctId ?? match.id),
      field("Brief title", identification.briefTitle ?? match.title),
      field("Official title", identification.officialTitle),
      field("Status", status.overallStatus ?? match.status),
      field("Phase", phases || match.phase),
      field("Study type", design.studyType),
      field("Conditions", conditions || match.condition),
      field(
        "Lead sponsor",
        getNested(sponsors, "leadSponsor", "name") ?? match.sponsor,
      ),
    ].filter(Boolean) as Array<[string, string]>,
    paragraphs: [
      compactText(description.briefSummary ?? match.summary),
      compactText(description.detailedDescription),
    ].filter(Boolean) as string[],
  };

  const eligibilitySection: PrettyStudySection = {
    title: "Eligibility",
    fields: [
      field("Sex", eligibility.sex ?? match.sex),
      field("Minimum age", eligibility.minimumAge ?? match.minimum_age),
      field("Maximum age", eligibility.maximumAge ?? match.maximum_age),
      field("Healthy volunteers", eligibility.healthyVolunteers),
      field("Standard age groups", joinValues(asArray(eligibility.stdAges))),
      field("Study population", eligibility.studyPopulation),
      field("Sampling method", eligibility.samplingMethod),
    ].filter(Boolean) as Array<[string, string]>,
    paragraphs: [compactText(eligibility.eligibilityCriteria)].filter(
      Boolean,
    ) as string[],
  };

  const centralContacts = asArray(contacts.centralContacts).map((contact) => {
    const row = asRecord(contact);
    return joinValues([row.name, row.role, row.phone, row.email], " • ");
  });
  const officials = asArray(contacts.overallOfficials).map((official) => {
    const row = asRecord(official);
    return joinValues([row.name, row.role, row.affiliation], " • ");
  });
  const locations = asArray(contacts.locations)
    .slice(0, 12)
    .map((location) => {
      const row = asRecord(location);
      const place = joinValues([
        row.facility,
        row.city,
        row.state,
        row.zip,
        row.country,
      ]);
      const statusText = compactText(row.status);
      return [place, statusText ? `status: ${statusText}` : undefined]
        .filter(Boolean)
        .join(" • ");
    });
  const locationOverflow =
    asArray(contacts.locations).length > 12
      ? [
          `+${asArray(contacts.locations).length - 12} more listed locations in raw JSON`,
        ]
      : [];

  const locationsSection: PrettyStudySection = {
    title: "Locations & contacts",
    fields: [
      field("Closest listed site", match.location),
      field("Closest site status", match.location_status),
      field("Approximate distance", formatEstimatedSiteDistance(match)),
      field("Local site contact", match.contact_name),
      field("Local contact phone", match.contact_phone),
      field("Local contact email", match.contact_email),
      field("Study contact", match.study_contact_name),
      field("Study contact phone", match.study_contact_phone),
      field("Study contact email", match.study_contact_email),
      field("Study official", match.study_official_name),
      field("Study official phone", match.study_official_phone),
      field("Study official email", match.study_official_email),
    ].filter(Boolean) as Array<[string, string]>,
    items: [
      ...centralContacts,
      ...officials,
      ...locations,
      ...locationOverflow,
    ].filter(Boolean) as string[],
  };

  const interventions = asArray(armsInterventions.interventions).map(
    (intervention) => {
      const row = asRecord(intervention);
      return joinValues([row.type, row.name, row.description], " • ");
    },
  );
  const arms = asArray(armsInterventions.armGroups).map((arm) => {
    const row = asRecord(arm);
    return joinValues([row.label, row.type, row.description], " • ");
  });
  const designSection: PrettyStudySection = {
    title: "Study design",
    fields: [
      field("Allocation", designInfo.allocation),
      field("Intervention model", designInfo.interventionModel),
      field("Primary purpose", designInfo.primaryPurpose),
      field("Masking", getNested(designInfo, "maskingInfo", "masking")),
      field("Observational model", designInfo.observationalModel),
      field("Time perspective", designInfo.timePerspective),
      field(
        "Enrollment",
        joinValues([enrollmentInfo.count, enrollmentInfo.type], " "),
      ),
    ].filter(Boolean) as Array<[string, string]>,
    paragraphs: [compactText(designInfo.interventionModelDescription)].filter(
      Boolean,
    ) as string[],
    items: [...interventions, ...arms].filter(Boolean) as string[],
  };

  const primaryOutcomes = asArray(outcomes.primaryOutcomes)
    .map((outcome) => {
      const row = asRecord(outcome);
      return joinValues([row.measure, row.timeFrame, row.description], " • ");
    })
    .filter(Boolean) as string[];
  const secondaryOutcomes = asArray(outcomes.secondaryOutcomes)
    .map((outcome) => {
      const row = asRecord(outcome);
      return joinValues([row.measure, row.timeFrame, row.description], " • ");
    })
    .filter(Boolean) as string[];
  const otherOutcomes = asArray(outcomes.otherOutcomes)
    .map((outcome) => {
      const row = asRecord(outcome);
      return joinValues([row.measure, row.timeFrame, row.description], " • ");
    })
    .filter(Boolean) as string[];
  const outcomesSection: PrettyStudySection = {
    title: "Outcomes",
    groups: [
      { title: "Primary outcomes", items: primaryOutcomes },
      { title: "Secondary outcomes", items: secondaryOutcomes },
      { title: "Other outcomes", items: otherOutcomes },
    ].filter((group) => group.items.length),
  };

  const datesSection: PrettyStudySection = {
    title: "Dates",
    fields: [
      field("Start date", dateStructText(status, "startDateStruct")),
      field(
        "Primary completion",
        dateStructText(status, "primaryCompletionDateStruct"),
      ),
      field("Completion", dateStructText(status, "completionDateStruct")),
      field("Study first submitted", status.studyFirstSubmitDate),
      field(
        "Study first posted",
        dateStructText(status, "studyFirstPostDateStruct"),
      ),
      field("Last update submitted", status.lastUpdateSubmitDate),
      field(
        "Last update posted",
        dateStructText(status, "lastUpdatePostDateStruct"),
      ),
      field("Status verified", status.statusVerifiedDate),
    ].filter(Boolean) as Array<[string, string]>,
  };

  return [
    overview,
    eligibilitySection,
    locationsSection,
    designSection,
    outcomesSection,
    datesSection,
  ].filter(sectionHasContent);
}

function PrettyStudySectionCard({ section }: { section: PrettyStudySection }) {
  return (
    <section className="mt-5 rounded-2xl border bg-white p-5">
      <h3 className="mb-4 text-lg font-semibold tracking-tight">
        {section.title}
      </h3>
      {Boolean(section.fields?.length) && (
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          {section.fields?.map(([label, value]) => (
            <div key={label}>
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="font-medium whitespace-pre-wrap">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {section.paragraphs?.map((paragraph, index) => (
        <p
          key={`${section.title}-paragraph-${index}`}
          className="text-muted-foreground mt-3 text-sm leading-6 whitespace-pre-wrap"
        >
          {paragraph}
        </p>
      ))}
      {Boolean(section.items?.length) && (
        <ul className="mt-3 space-y-2 text-sm">
          {section.items?.map((item, index) => (
            <li
              key={`${section.title}-item-${index}`}
              className="rounded-xl bg-slate-50 px-3 py-2"
            >
              {item}
            </li>
          ))}
        </ul>
      )}
      {section.groups?.map((group) => (
        <div
          key={group.title}
          className="mt-4 first:mt-0"
        >
          <h4 className="text-muted-foreground mb-2 text-sm font-semibold tracking-wide uppercase">
            {group.title}
          </h4>
          <ul className="space-y-2 text-sm">
            {group.items.map((item, index) => (
              <li
                key={`${group.title}-item-${index}`}
                className="rounded-xl bg-slate-50 px-3 py-2"
              >
                {item}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function StudyMap({ match }: { match: TrialMatch }) {
  const hasCoordinates =
    typeof match.latitude === "number" && typeof match.longitude === "number";
  const query =
    match.location ||
    (hasCoordinates ? `${match.latitude},${match.longitude}` : "");

  if (!query) return null;

  return (
    <iframe
      title={`${match.id || "study"} map`}
      src={`https://www.google.com/maps?q=${encodeURIComponent(query)}&z=13&output=embed`}
      className="h-64 w-full rounded-xl border"
      loading="lazy"
      referrerPolicy="no-referrer-when-downgrade"
    />
  );
}

type StudyResultSnapshot = {
  trialCount?: number | null;
  matches: TrialMatch[];
};

function normalizeStudyResultSnapshot(
  snapshot?: StudyResultSnapshot | PersistedStudyResultSnapshot,
): StudyResultSnapshot | undefined {
  if (!snapshot) return undefined;
  if ("matches" in snapshot) return snapshot;
  return {
    trialCount: snapshot.trial_count,
    matches: snapshot.trial_matches ?? [],
  };
}

function StudyResults({
  trialCount,
  matches,
}: {
  trialCount?: number | null;
  matches?: TrialMatch[];
}) {
  const stream = useStreamContext();
  const resolvedMatches = matches ?? stream.values.trial_matches ?? [];
  const resolvedTrialCount = trialCount ?? stream.values.trial_count;
  const [fullscreenStudy, setFullscreenStudy] = useState<{
    match: TrialMatch;
    index: number;
  } | null>(null);
  const [visibleMapKeys, setVisibleMapKeys] = useState<Record<string, boolean>>(
    {},
  );

  if (!resolvedMatches.length) return null;

  const focusAgentOnStudy = (match: TrialMatch) => {
    if (!match.id || stream.isLoading) return;
    setFullscreenStudy(null);

    const message: Message = {
      id: `${DO_NOT_RENDER_ID_PREFIX}${uuidv4()}`,
      type: "human",
      content: `I want to ask about study ${match.id}.`,
    };
    const toolMessages = ensureToolCallsHaveResponses(stream.messages);

    stream.submit(
      { messages: [...toolMessages, message] },
      {
        streamMode: ["values"],
        streamSubgraphs: true,
        streamResumable: true,
        optimisticValues: (previous) => ({
          ...previous,
          trial_matches: [],
          trial_count: null,
          messages: [...(previous.messages ?? []), ...toolMessages, message],
        }),
      },
    );
  };

  const fullscreenKey = fullscreenStudy
    ? getStudyKey(fullscreenStudy.match, fullscreenStudy.index)
    : undefined;
  const fullscreenMapVisible =
    fullscreenKey !== undefined && visibleMapKeys[fullscreenKey] === true;
  const fullscreenVisibleDetails = fullscreenStudy
    ? getVisibleStudyDetails(fullscreenStudy.match)
    : [];
  const fullscreenRawDetails = fullscreenStudy
    ? getRawStudyDetails(fullscreenStudy.match)
    : [];
  const fullscreenRawJson = fullscreenStudy
    ? formatJsonForDisplay(fullscreenStudy.match.raw_json)
    : null;
  const fullscreenPrettySections = fullscreenStudy
    ? getPrettyStudySections(fullscreenStudy.match)
    : [];

  return (
    <div className="mx-auto w-full max-w-3xl rounded-2xl border bg-white p-4 shadow-xs">
      <div className="mb-3">
        <p className="font-medium">
          Study matches
          {typeof resolvedTrialCount === "number"
            ? ` (${resolvedTrialCount} total)`
            : ""}
        </p>
        <p className="text-muted-foreground mt-1 text-sm">
          Scroll through the matches, then open any card for the full view.
        </p>
      </div>

      <div className="max-h-[42rem] space-y-3 overflow-y-auto pr-1">
        {resolvedMatches.map((match, index) => {
          const studyKey = getStudyKey(match, index);
          const estimatedSiteDistance = formatEstimatedSiteDistance(match);

          return (
            <button
              key={studyKey}
              type="button"
              onClick={() => setFullscreenStudy({ match, index })}
              className="hover:border-primary/50 hover:bg-primary/5 focus-visible:border-primary focus-visible:ring-ring/50 block w-full rounded-2xl border bg-slate-50 p-4 text-left transition focus-visible:ring-[3px] focus-visible:outline-none"
            >
              <div className="flex items-start gap-3">
                <div className="flex-1">
                  <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                    {match.id || `Study ${index + 1}`}
                  </p>
                  <h3 className="mt-1 text-base leading-snug font-semibold">
                    {match.title || "Untitled study"}
                  </h3>
                  <p className="text-muted-foreground mt-1 text-sm">
                    {[match.status, match.phase, estimatedSiteDistance]
                      .filter(Boolean)
                      .join(" • ")}
                  </p>
                </div>
                <span
                  className="text-primary shrink-0 rounded-full border bg-white p-2"
                  aria-hidden="true"
                >
                  <Maximize2 className="h-4 w-4" />
                </span>
              </div>

              {match.summary && (
                <p className="text-muted-foreground mt-3 line-clamp-3 text-sm">
                  {match.summary}
                </p>
              )}
            </button>
          );
        })}
      </div>

      {fullscreenStudy && fullscreenKey && (
        <div
          className="fixed inset-0 z-50 bg-black/40 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label={`${fullscreenStudy.match.id || "Study"} details`}
        >
          <div className="mx-auto flex h-full max-w-5xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b p-5">
              <div>
                <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                  {fullscreenStudy.match.id ||
                    `Study ${fullscreenStudy.index + 1}`}
                </p>
                <h2 className="mt-1 text-xl leading-snug font-semibold">
                  {fullscreenStudy.match.title || "Untitled study"}
                </h2>
                <p className="text-muted-foreground mt-1 text-sm">
                  {[
                    fullscreenStudy.match.status,
                    fullscreenStudy.match.phase,
                    formatEstimatedSiteDistance(fullscreenStudy.match),
                  ]
                    .filter(Boolean)
                    .join(" • ")}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => setFullscreenStudy(null)}
                aria-label="Close study details"
                className="shrink-0 rounded-full"
              >
                <XIcon className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              {fullscreenStudy.match.summary && (
                <p className="text-muted-foreground text-sm leading-6">
                  {fullscreenStudy.match.summary}
                </p>
              )}

              <div className="mt-5 rounded-2xl border bg-slate-50 p-4">
                <dl className="grid gap-3 text-sm sm:grid-cols-2">
                  {fullscreenVisibleDetails.map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd className="font-medium">{value}</dd>
                    </div>
                  ))}
                </dl>
              </div>

              {fullscreenPrettySections.map((section) => (
                <PrettyStudySectionCard
                  key={section.title}
                  section={section}
                />
              ))}

              <div className="mt-5 rounded-2xl border p-4">
                <p className="text-muted-foreground mb-3 text-xs font-medium tracking-wide uppercase">
                  All available match fields
                </p>
                <dl className="grid gap-2 text-xs">
                  {fullscreenRawDetails.map(([key, value]) => (
                    <div
                      key={key}
                      className="grid gap-1 sm:grid-cols-[10rem_1fr]"
                    >
                      <dt className="text-muted-foreground">{key}</dt>
                      <dd className="break-words">
                        {typeof value === "boolean"
                          ? value
                            ? "true"
                            : "false"
                          : String(value)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>

              {fullscreenRawJson && (
                <div className="mt-5 rounded-2xl border p-4">
                  <p className="text-muted-foreground mb-3 text-xs font-medium tracking-wide uppercase">
                    Raw ClinicalTrials.gov JSON
                  </p>
                  <pre className="max-h-96 overflow-auto rounded-xl bg-slate-950 p-4 text-xs leading-5 whitespace-pre-wrap text-slate-100">
                    {fullscreenRawJson}
                  </pre>
                </div>
              )}

              {fullscreenMapVisible && (
                <div className="mt-5">
                  <StudyMap match={fullscreenStudy.match} />
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-2 border-t p-5">
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  setVisibleMapKeys((previous) => ({
                    ...previous,
                    [fullscreenKey]: true,
                  }))
                }
              >
                Show location on map
              </Button>
              <Button
                type="button"
                onClick={() => focusAgentOnStudy(fullscreenStudy.match)}
                disabled={!fullscreenStudy.match.id || stream.isLoading}
              >
                Ask about this study
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function OpenGitHubRepo() {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <a
            href="https://github.com/langchain-ai/agent-chat-ui"
            target="_blank"
            className="flex items-center justify-center"
          >
            <GitHubSVG
              width="24"
              height="24"
            />
          </a>
        </TooltipTrigger>
        <TooltipContent side="left">
          <p>Open GitHub repo</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function Thread() {
  const [artifactContext, setArtifactContext] = useArtifactContext();
  const [artifactOpen, closeArtifact] = useArtifactOpen();

  const [threadId, _setThreadId] = useQueryState("threadId");
  const [chatHistoryOpen, setChatHistoryOpen] = useQueryState(
    "chatHistoryOpen",
    parseAsBoolean.withDefault(false),
  );
  const [hideToolCalls, setHideToolCalls] = useQueryState(
    "hideToolCalls",
    parseAsBoolean.withDefault(false),
  );
  const [input, setInput] = useState("");
  const {
    contentBlocks,
    setContentBlocks,
    handleFileUpload,
    dropRef,
    removeBlock,
    resetBlocks: _resetBlocks,
    dragOver,
    handlePaste,
  } = useFileUpload();
  const [firstTokenReceived, setFirstTokenReceived] = useState(false);
  const [studyResultSnapshots, setStudyResultSnapshots] = useState<
    Record<string, StudyResultSnapshot>
  >({});
  const [locationEditorOpen, setLocationEditorOpen] = useState(false);
  const isLargeScreen = useMediaQuery("(min-width: 1024px)");

  const stream = useStreamContext();
  const messages = stream.messages;
  const isLoading = stream.isLoading;

  const lastError = useRef<string | undefined>(undefined);

  const setThreadId = (id: string | null) => {
    _setThreadId(id);

    // close artifact and reset artifact context
    closeArtifact();
    setArtifactContext({});
  };

  useEffect(() => {
    if (!stream.error) {
      lastError.current = undefined;
      return;
    }
    try {
      const message = (stream.error as any).message;
      if (!message || lastError.current === message) {
        // Message has already been logged. do not modify ref, return early.
        return;
      }

      // Message is defined, and it has not been logged yet. Save it, and send the error
      lastError.current = message;
      toast.error("An error occurred. Please try again.", {
        description: (
          <p>
            <strong>Error:</strong> <code>{message}</code>
          </p>
        ),
        richColors: true,
        closeButton: true,
      });
    } catch {
      // no-op
    }
  }, [stream.error]);

  // TODO: this should be part of the useStream hook
  const prevMessageLength = useRef(0);
  useEffect(() => {
    if (
      messages.length !== prevMessageLength.current &&
      messages?.length &&
      messages[messages.length - 1].type === "ai"
    ) {
      setFirstTokenReceived(true);
    }

    prevMessageLength.current = messages.length;
  }, [messages]);

  useEffect(() => {
    const latestMessage = messages
      .filter((message) => !message.id?.startsWith(DO_NOT_RENDER_ID_PREFIX))
      .at(-1);
    const matches = stream.values.trial_matches ?? [];
    if (
      latestMessage?.type !== "ai" ||
      !latestMessage.id ||
      matches.length === 0 ||
      getContentString(latestMessage.content).trim() !== "Study matches"
    ) {
      return;
    }
    const latestMessageId = latestMessage.id;

    setStudyResultSnapshots((previous) => {
      if (previous[latestMessageId]?.matches === matches) return previous;
      return {
        ...previous,
        [latestMessageId]: {
          trialCount: stream.values.trial_count,
          matches,
        },
      };
    });
  }, [messages, stream.values.trial_count, stream.values.trial_matches]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if ((input.trim().length === 0 && contentBlocks.length === 0) || isLoading)
      return;
    setFirstTokenReceived(false);

    const newHumanMessage: Message = {
      id: uuidv4(),
      type: "human",
      content: [
        ...(input.trim().length > 0 ? [{ type: "text", text: input }] : []),
        ...contentBlocks,
      ] as Message["content"],
    };

    const toolMessages = ensureToolCallsHaveResponses(stream.messages);

    const context =
      Object.keys(artifactContext).length > 0 ? artifactContext : undefined;

    stream.submit(
      { messages: [...toolMessages, newHumanMessage], context },
      {
        streamMode: ["values"],
        streamSubgraphs: true,
        streamResumable: true,
        optimisticValues: (prev) => ({
          ...prev,
          context,
          trial_matches: [],
          trial_count: null,
          messages: [
            ...(prev.messages ?? []),
            ...toolMessages,
            newHumanMessage,
          ],
        }),
      },
    );

    setInput("");
    setContentBlocks([]);
  };

  const handleRegenerate = (
    parentCheckpoint: Checkpoint | null | undefined,
  ) => {
    // Do this so the loading state is correct
    prevMessageLength.current = prevMessageLength.current - 1;
    setFirstTokenReceived(false);
    stream.submit(undefined, {
      checkpoint: parentCheckpoint,
      streamMode: ["values"],
      streamSubgraphs: true,
      streamResumable: true,
    });
  };

  const chatStarted = !!threadId || !!messages.length;
  const hasNoAIOrToolMessages = !messages.find(
    (m) => m.type === "ai" || m.type === "tool",
  );

  return (
    <div className="flex h-screen w-full overflow-hidden">
      <div className="relative hidden lg:flex">
        <motion.div
          className="absolute z-20 h-full overflow-hidden border-r bg-white"
          style={{ width: 300 }}
          animate={
            isLargeScreen
              ? { x: chatHistoryOpen ? 0 : -300 }
              : { x: chatHistoryOpen ? 0 : -300 }
          }
          initial={{ x: -300 }}
          transition={
            isLargeScreen
              ? { type: "spring", stiffness: 300, damping: 30 }
              : { duration: 0 }
          }
        >
          <div
            className="relative h-full"
            style={{ width: 300 }}
          >
            <ThreadHistory />
          </div>
        </motion.div>
      </div>

      <div
        className={cn(
          "grid w-full grid-cols-[1fr_0fr] transition-all duration-500",
          artifactOpen && "grid-cols-[3fr_2fr]",
        )}
      >
        <motion.div
          className={cn(
            "relative flex min-w-0 flex-1 flex-col overflow-hidden",
            !chatStarted && "grid-rows-[1fr]",
          )}
          layout={isLargeScreen}
          animate={{
            marginLeft: chatHistoryOpen ? (isLargeScreen ? 300 : 0) : 0,
            width: chatHistoryOpen
              ? isLargeScreen
                ? "calc(100% - 300px)"
                : "100%"
              : "100%",
          }}
          transition={
            isLargeScreen
              ? { type: "spring", stiffness: 300, damping: 30 }
              : { duration: 0 }
          }
        >
          {!chatStarted && (
            <div className="absolute top-0 left-0 z-10 flex w-full items-center justify-between gap-3 p-2 pl-4">
              <div>
                {(!chatHistoryOpen || !isLargeScreen) && (
                  <Button
                    className="hover:bg-gray-100"
                    variant="ghost"
                    onClick={() => setChatHistoryOpen((p) => !p)}
                  >
                    {chatHistoryOpen ? (
                      <PanelRightOpen className="size-5" />
                    ) : (
                      <PanelRightClose className="size-5" />
                    )}
                  </Button>
                )}
              </div>
              <div className="absolute top-2 right-4 flex items-center">
                <OpenGitHubRepo />
              </div>
            </div>
          )}
          {chatStarted && (
            <div className="relative z-10 flex items-center justify-between gap-3 p-2">
              <div className="relative flex items-center justify-start gap-2">
                <div className="absolute left-0 z-10">
                  {(!chatHistoryOpen || !isLargeScreen) && (
                    <Button
                      className="hover:bg-gray-100"
                      variant="ghost"
                      onClick={() => setChatHistoryOpen((p) => !p)}
                    >
                      {chatHistoryOpen ? (
                        <PanelRightOpen className="size-5" />
                      ) : (
                        <PanelRightClose className="size-5" />
                      )}
                    </Button>
                  )}
                </div>
                <motion.button
                  className="flex cursor-pointer items-center gap-2"
                  onClick={() => setThreadId(null)}
                  animate={{
                    marginLeft: !chatHistoryOpen ? 48 : 0,
                  }}
                  transition={{
                    type: "spring",
                    stiffness: 300,
                    damping: 30,
                  }}
                >
                  <LangGraphLogoSVG
                    width={32}
                    height={32}
                  />
                  <span className="text-xl font-semibold tracking-tight">
                    Agent Chat
                  </span>
                </motion.button>
              </div>

              <div className="flex items-center gap-4">
                <div className="flex items-center">
                  <OpenGitHubRepo />
                </div>
                <TooltipIconButton
                  size="lg"
                  className="p-4"
                  tooltip="New thread"
                  variant="ghost"
                  onClick={() => setThreadId(null)}
                >
                  <SquarePen className="size-5" />
                </TooltipIconButton>
              </div>

              <div className="from-background to-background/0 absolute inset-x-0 top-full h-5 bg-gradient-to-b" />
            </div>
          )}

          <StickToBottom className="relative flex-1 overflow-hidden">
            <StickyToBottomContent
              className={cn(
                "absolute inset-0 overflow-y-scroll px-4 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-gray-300 [&::-webkit-scrollbar-track]:bg-transparent",
                !chatStarted && "mt-[25vh] flex flex-col items-stretch",
                chatStarted && "grid grid-rows-[1fr_auto]",
              )}
              contentClassName="pt-8 pb-16 max-w-3xl mx-auto flex flex-col gap-4 w-full"
              content={
                <>
                  {messages
                    .filter((m) => !m.id?.startsWith(DO_NOT_RENDER_ID_PREFIX))
                    .map((message, index) => {
                      const messageKey =
                        message.id || `${message.type}-${index}`;
                      const snapshot = normalizeStudyResultSnapshot(
                        message.id
                          ? (stream.values.study_result_snapshots?.[
                              message.id
                            ] ?? studyResultSnapshots[message.id])
                          : undefined,
                      );
                      const isStudyMatchMessage =
                        snapshot &&
                        getContentString(message.content).trim() ===
                          "Study matches";

                      return message.type === "human" ? (
                        <HumanMessage
                          key={messageKey}
                          message={message}
                          isLoading={isLoading}
                        />
                      ) : (
                        <Fragment key={messageKey}>
                          {!isStudyMatchMessage && (
                            <AssistantMessage
                              message={message}
                              isLoading={isLoading}
                              handleRegenerate={handleRegenerate}
                            />
                          )}
                          {snapshot && (
                            <StudyResults
                              trialCount={snapshot.trialCount}
                              matches={snapshot.matches}
                            />
                          )}
                        </Fragment>
                      );
                    })}
                  {/* Special rendering case where there are no AI/tool messages, but there is an interrupt.
                    We need to render it outside of the messages list, since there are no messages to render */}
                  {hasNoAIOrToolMessages && !!stream.interrupt && (
                    <AssistantMessage
                      key="interrupt-msg"
                      message={undefined}
                      isLoading={isLoading}
                      handleRegenerate={handleRegenerate}
                    />
                  )}
                  {isLoading && !firstTokenReceived && (
                    <AssistantMessageLoading />
                  )}
                </>
              }
              footer={
                <div className="sticky bottom-0 flex flex-col items-center gap-3 bg-white">
                  {!chatStarted && (
                    <div className="flex items-center gap-3">
                      <LangGraphLogoSVG className="h-8 flex-shrink-0" />
                      <h1 className="text-2xl font-semibold tracking-tight">
                        Agent Chat
                      </h1>
                    </div>
                  )}

                  <ScrollToBottom className="animate-in fade-in-0 zoom-in-95 absolute bottom-full left-1/2 mb-4 -translate-x-1/2" />

                  <UserInfoSummary />
                  <LocationRequest
                    forceOpen={locationEditorOpen}
                    onClose={() => setLocationEditorOpen(false)}
                  />
                  <SuggestedOptions
                    onOpenLocationEditor={() => setLocationEditorOpen(true)}
                  />

                  <div
                    ref={dropRef}
                    className={cn(
                      "bg-muted relative z-10 mx-auto mb-8 w-full max-w-3xl rounded-2xl shadow-xs transition-all",
                      dragOver
                        ? "border-primary border-2 border-dotted"
                        : "border border-solid",
                    )}
                  >
                    <form
                      onSubmit={handleSubmit}
                      className="mx-auto grid max-w-3xl grid-rows-[1fr_auto] gap-2"
                    >
                      <ContentBlocksPreview
                        blocks={contentBlocks}
                        onRemove={removeBlock}
                      />
                      <textarea
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onPaste={handlePaste}
                        onKeyDown={(e) => {
                          if (
                            e.key === "Enter" &&
                            !e.shiftKey &&
                            !e.metaKey &&
                            !e.nativeEvent.isComposing
                          ) {
                            e.preventDefault();
                            const el = e.target as HTMLElement | undefined;
                            const form = el?.closest("form");
                            form?.requestSubmit();
                          }
                        }}
                        placeholder="Type your message..."
                        className="field-sizing-content resize-none border-none bg-transparent p-3.5 pb-0 shadow-none ring-0 outline-none focus:ring-0 focus:outline-none"
                      />

                      <div className="flex items-center gap-6 p-2 pt-4">
                        <div>
                          <div className="flex items-center space-x-2">
                            <Switch
                              id="render-tool-calls"
                              checked={hideToolCalls ?? false}
                              onCheckedChange={setHideToolCalls}
                            />
                            <Label
                              htmlFor="render-tool-calls"
                              className="text-sm text-gray-600"
                            >
                              Hide Tool Calls
                            </Label>
                          </div>
                        </div>
                        <Label
                          htmlFor="file-input"
                          className="flex cursor-pointer items-center gap-2"
                        >
                          <Plus className="size-5 text-gray-600" />
                          <span className="text-sm text-gray-600">
                            Upload PDF or Image
                          </span>
                        </Label>
                        <input
                          id="file-input"
                          type="file"
                          onChange={handleFileUpload}
                          multiple
                          accept="image/jpeg,image/png,image/gif,image/webp,application/pdf"
                          className="hidden"
                        />
                        {stream.isLoading ? (
                          <Button
                            key="stop"
                            onClick={() => stream.stop()}
                            className="ml-auto"
                          >
                            <LoaderCircle className="h-4 w-4 animate-spin" />
                            Cancel
                          </Button>
                        ) : (
                          <Button
                            type="submit"
                            className="ml-auto shadow-md transition-all"
                            disabled={
                              isLoading ||
                              (!input.trim() && contentBlocks.length === 0)
                            }
                          >
                            Send
                          </Button>
                        )}
                      </div>
                    </form>
                  </div>
                </div>
              }
            />
          </StickToBottom>
        </motion.div>
        <div className="relative flex flex-col border-l">
          <div className="absolute inset-0 flex min-w-[30vw] flex-col">
            <div className="grid grid-cols-[1fr_auto] border-b p-4">
              <ArtifactTitle className="truncate overflow-hidden" />
              <button
                onClick={closeArtifact}
                className="cursor-pointer"
              >
                <XIcon className="size-5" />
              </button>
            </div>
            <ArtifactContent className="relative flex-grow" />
          </div>
        </div>
      </div>
    </div>
  );
}
