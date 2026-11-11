"use client";

import { useActionState, useState } from "react";
import { saveAutomationAction, type EditorState } from "./actions";
import { button, field } from "../ui";

// The automation editor (automations spec §1: "a list of rules edited in a
// form, not a drag-and-drop canvas"). It keeps the conditions and steps in
// state and posts them as two JSON fields; the server checks every part
// again (lib/automations/form.ts), so nothing here is trusted.

type Cond = {
  key: string;
  kind: "language" | "tag" | "email" | "phone" | "event";
  op: string;
  value: string;
  eventField: string;
};

type StepKind =
  | "add_tag"
  | "remove_tag"
  | "create_task"
  | "wait"
  | "stop_if_replied"
  | "send_email"
  | "send_whatsapp";

type StepRow = {
  key: string;
  kind: StepKind;
  tag: string;
  title: string;
  taskType: string;
  dueMode: "next_working_day" | "hours";
  dueHours: string;
  assignTo: string;
  waitDays: string;
  waitHours: string;
  template: string;
  purpose: string;
};

// What the server sent for an existing automation (the shapes of
// lib/automations/model.ts, kept loose here).
export type InitialCondition = {
  field: string;
  op: string;
  value?: string;
};
export type InitialStep = { kind: StepKind; settings: Record<string, unknown> };

const STEP_LABEL: Record<StepKind, string> = {
  add_tag: "Add a tag",
  remove_tag: "Remove a tag",
  create_task: "Create a task",
  wait: "Wait",
  stop_if_replied: "Stop if the customer replied",
  send_email: "Send an email",
  send_whatsapp: "Send a WhatsApp message",
};

let counter = 0;
const nextKey = () => `k${++counter}`;

const blankStep = (kind: StepKind): StepRow => ({
  key: nextKey(),
  kind,
  tag: "",
  title: "",
  taskType: "follow_up",
  dueMode: "next_working_day",
  dueHours: "24",
  assignTo: "deal_owner",
  waitDays: "1",
  waitHours: "0",
  template: "",
  purpose: "service",
});

function stepFromInitial(s: InitialStep): StepRow {
  const row = blankStep(s.kind);
  const x = s.settings;
  const str = (v: unknown, d = "") => (typeof v === "string" ? v : d);
  const num = (v: unknown, d: string) =>
    typeof v === "number" ? String(v) : d;
  row.tag = str(x.tag);
  row.title = str(x.title);
  row.taskType = str(x.type, "follow_up");
  row.assignTo = str(x.assignTo, "deal_owner");
  const due = x.due as { hours?: number } | undefined;
  if (due && typeof due.hours === "number") {
    row.dueMode = "hours";
    row.dueHours = String(due.hours);
  }
  row.waitDays = num(x.days, "0");
  row.waitHours = num(x.hours, "0");
  row.template = str(x.template);
  row.purpose = str(x.purpose, "service");
  return row;
}

function condFromInitial(c: InitialCondition): Cond {
  const base = {
    key: nextKey(),
    op: c.op,
    value: c.value ?? "",
    eventField: "",
  };
  if (c.field === "person.preferred_language")
    return { ...base, kind: "language" };
  if (c.field === "person.tag") return { ...base, kind: "tag" };
  if (c.field === "person.email") return { ...base, kind: "email" };
  if (c.field === "person.phone") return { ...base, kind: "phone" };
  return {
    ...base,
    kind: "event",
    eventField: c.field.replace(/^event\./, ""),
  };
}

function condToJson(c: Cond): Record<string, unknown> {
  switch (c.kind) {
    case "language":
      return { field: "person.preferred_language", op: c.op, value: c.value };
    case "tag":
      return { field: "person.tag", op: c.op, value: c.value };
    case "email":
      return { field: "person.email", op: c.op };
    case "phone":
      return { field: "person.phone", op: c.op };
    case "event":
      return { field: `event.${c.eventField}`, op: c.op, value: c.value };
  }
}

function stepToJson(s: StepRow): Record<string, unknown> {
  const int = (v: string) => (v.trim() === "" ? 0 : Number(v));
  switch (s.kind) {
    case "add_tag":
    case "remove_tag":
      return { kind: s.kind, settings: { tag: s.tag } };
    case "create_task":
      return {
        kind: s.kind,
        settings: {
          title: s.title,
          type: s.taskType,
          due:
            s.dueMode === "hours"
              ? { hours: int(s.dueHours) }
              : { nextWorkingDay: true },
          assignTo: s.assignTo,
        },
      };
    case "wait":
      return {
        kind: s.kind,
        settings: { days: int(s.waitDays), hours: int(s.waitHours) },
      };
    case "stop_if_replied":
      return { kind: s.kind, settings: {} };
    case "send_email":
    case "send_whatsapp":
      return {
        kind: s.kind,
        settings: { template: s.template, purpose: s.purpose },
      };
  }
}

const CONDITION_KIND_LABEL: Record<Cond["kind"], string> = {
  language: "Language",
  tag: "Tag",
  email: "Email",
  phone: "Phone",
  event: "Detail of what happened",
};

function newCond(kind: Cond["kind"]): Cond {
  const op =
    kind === "tag"
      ? "has"
      : kind === "email" || kind === "phone"
        ? "present"
        : "eq";
  return {
    key: nextKey(),
    kind,
    op,
    value: kind === "language" ? "en" : "",
    eventField: "",
  };
}

export function AutomationEditor({
  id,
  name: initialName,
  trigger: initialTrigger,
  conditions,
  steps,
  triggers,
}: {
  id?: string;
  name: string;
  trigger: string;
  conditions: InitialCondition[];
  steps: InitialStep[];
  triggers: { value: string; label: string }[];
}) {
  const [state, action, pending] = useActionState<EditorState, FormData>(
    saveAutomationAction,
    {},
  );
  const [name, setName] = useState(initialName);
  const [trigger, setTrigger] = useState(
    initialTrigger || triggers[0]?.value || "",
  );
  const [conds, setConds] = useState<Cond[]>(() =>
    conditions.map(condFromInitial),
  );
  const [rows, setRows] = useState<StepRow[]>(() =>
    steps.length ? steps.map(stepFromInitial) : [blankStep("add_tag")],
  );

  const patchStep = (key: string, patch: Partial<StepRow>) =>
    setRows((r) => r.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  const patchCond = (key: string, patch: Partial<Cond>) =>
    setConds((r) => r.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  const move = (i: number, by: -1 | 1) =>
    setRows((r) => {
      const j = i + by;
      if (j < 0 || j >= r.length) return r;
      const copy = [...r];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });

  return (
    <form action={action} className="mt-6 flex flex-col gap-8">
      <input type="hidden" name="id" value={id ?? ""} />
      <input
        type="hidden"
        name="conditions"
        value={JSON.stringify(conds.map(condToJson))}
      />
      <input
        type="hidden"
        name="steps"
        value={JSON.stringify(rows.map(stepToJson))}
      />

      {state.errors && state.errors.length > 0 && (
        <div
          role="alert"
          className="border-danger/40 bg-danger/5 text-danger rounded-xl border px-4 py-3 text-sm"
        >
          <p className="font-medium">Not saved:</p>
          <ul className="mt-1 list-disc pl-5">
            {state.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Name
          <input
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={120}
            className={field}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          When this happens
          <select
            name="trigger"
            value={trigger}
            onChange={(e) => setTrigger(e.target.value)}
            className={field}
          >
            {triggers.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <section aria-labelledby="conds">
        <h2 id="conds" className="font-semibold">
          Only if{" "}
          <span className="text-ink-muted text-sm font-normal">
            (all of these; leave empty to run every time)
          </span>
        </h2>
        <ul className="mt-3 flex flex-col gap-2">
          {conds.map((c) => (
            <li
              key={c.key}
              className="border-line flex flex-wrap items-center gap-2 rounded-xl border p-3 text-sm"
            >
              <span className="font-medium">
                {CONDITION_KIND_LABEL[c.kind]}
              </span>
              {c.kind === "event" && (
                <input
                  aria-label="Event field name"
                  value={c.eventField}
                  onChange={(e) =>
                    patchCond(c.key, { eventField: e.target.value })
                  }
                  placeholder="e.g. toStage"
                  className={`${field} w-36`}
                />
              )}
              <select
                aria-label="Operator"
                value={c.op}
                onChange={(e) => patchCond(c.key, { op: e.target.value })}
                className={field}
              >
                {c.kind === "tag" ? (
                  <>
                    <option value="has">has</option>
                    <option value="lacks">doesn&apos;t have</option>
                  </>
                ) : c.kind === "email" || c.kind === "phone" ? (
                  <>
                    <option value="present">is filled in</option>
                    <option value="missing">is empty</option>
                  </>
                ) : (
                  <>
                    <option value="eq">is</option>
                    <option value="neq">is not</option>
                  </>
                )}
              </select>
              {c.kind === "language" && (
                <select
                  aria-label="Language"
                  value={c.value}
                  onChange={(e) => patchCond(c.key, { value: e.target.value })}
                  className={field}
                >
                  <option value="en">English</option>
                  <option value="zh">中文</option>
                </select>
              )}
              {(c.kind === "tag" || c.kind === "event") && (
                <input
                  aria-label="Value"
                  value={c.value}
                  onChange={(e) => patchCond(c.key, { value: e.target.value })}
                  placeholder={c.kind === "tag" ? "tag name" : "value"}
                  maxLength={200}
                  className={`${field} w-44`}
                />
              )}
              <button
                type="button"
                onClick={() =>
                  setConds((r) => r.filter((x) => x.key !== c.key))
                }
                className="text-ink-muted ml-auto cursor-pointer text-xs underline"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-2">
          <label className="sr-only" htmlFor="add-cond">
            Add a condition
          </label>
          <select
            id="add-cond"
            value=""
            onChange={(e) => {
              const kind = e.target.value as Cond["kind"];
              if (kind) setConds((r) => [...r, newCond(kind)]);
            }}
            className={field}
          >
            <option value="">+ Add a condition…</option>
            {(Object.keys(CONDITION_KIND_LABEL) as Cond["kind"][]).map((k) => (
              <option key={k} value={k}>
                {CONDITION_KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section aria-labelledby="steps">
        <h2 id="steps" className="font-semibold">
          Then do these, in order
        </h2>
        <ol className="mt-3 flex flex-col gap-3">
          {rows.map((s, i) => (
            <li
              key={s.key}
              className="border-line rounded-xl border p-3 text-sm"
            >
              <div className="flex items-center gap-2">
                <span className="bg-lead-blue/50 rounded-full px-2 py-0.5 text-xs font-medium">
                  {i + 1}
                </span>
                <span className="font-medium">{STEP_LABEL[s.kind]}</span>
                <span className="ml-auto flex gap-3 text-xs">
                  <button
                    type="button"
                    onClick={() => move(i, -1)}
                    disabled={i === 0}
                    aria-label={`Move step ${i + 1} up`}
                    className="cursor-pointer underline disabled:opacity-40"
                  >
                    Up
                  </button>
                  <button
                    type="button"
                    onClick={() => move(i, 1)}
                    disabled={i === rows.length - 1}
                    aria-label={`Move step ${i + 1} down`}
                    className="cursor-pointer underline disabled:opacity-40"
                  >
                    Down
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setRows((r) => r.filter((x) => x.key !== s.key))
                    }
                    aria-label={`Remove step ${i + 1}`}
                    className="text-ink-muted cursor-pointer underline"
                  >
                    Remove
                  </button>
                </span>
              </div>
              <StepFields s={s} patch={(p) => patchStep(s.key, p)} />
            </li>
          ))}
        </ol>
        <div className="mt-3">
          <label className="sr-only" htmlFor="add-step">
            Add a step
          </label>
          <select
            id="add-step"
            value=""
            onChange={(e) => {
              const kind = e.target.value as StepKind;
              if (kind) setRows((r) => [...r, blankStep(kind)]);
            }}
            className={field}
          >
            <option value="">+ Add a step…</option>
            {(Object.keys(STEP_LABEL) as StepKind[]).map((k) => (
              <option key={k} value={k}>
                {STEP_LABEL[k]}
              </option>
            ))}
          </select>
        </div>
      </section>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className={`${button} disabled:opacity-60`}
        >
          {pending ? "Saving…" : id ? "Save changes" : "Create automation"}
        </button>
        {!id && (
          <p className="text-ink-muted text-xs">
            A new automation starts switched off.
          </p>
        )}
      </div>
    </form>
  );
}

function StepFields({
  s,
  patch,
}: {
  s: StepRow;
  patch: (p: Partial<StepRow>) => void;
}) {
  const label = "flex min-w-0 flex-col gap-1 text-xs font-medium";
  // Fill the card, never wider than it (phone widths).
  const ctl = `${field} w-full min-w-0`;
  switch (s.kind) {
    case "add_tag":
    case "remove_tag":
      return (
        <label className={`${label} mt-2`}>
          Tag
          <input
            value={s.tag}
            onChange={(e) => patch({ tag: e.target.value })}
            maxLength={60}
            className={`${field} max-w-xs`}
          />
        </label>
      );
    case "create_task":
      return (
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <label className={`${label} sm:col-span-2`}>
            Task title
            <input
              value={s.title}
              onChange={(e) => patch({ title: e.target.value })}
              maxLength={200}
              className={ctl}
            />
          </label>
          <label className={label}>
            Kind
            <select
              value={s.taskType}
              onChange={(e) => patch({ taskType: e.target.value })}
              className={ctl}
            >
              <option value="follow_up">Follow up</option>
              <option value="call">Call</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label className={label}>
            Assign to
            <select
              value={s.assignTo}
              onChange={(e) => patch({ assignTo: e.target.value })}
              className={ctl}
            >
              <option value="deal_owner">The deal&apos;s owner</option>
              <option value="duty_super_admin">The duty super_admin</option>
            </select>
          </label>
          <label className={label}>
            Due
            <select
              value={s.dueMode}
              onChange={(e) =>
                patch({ dueMode: e.target.value as StepRow["dueMode"] })
              }
              className={ctl}
            >
              <option value="next_working_day">The next working day</option>
              <option value="hours">In some hours</option>
            </select>
          </label>
          {s.dueMode === "hours" && (
            <label className={label}>
              Hours
              <input
                type="number"
                min={0}
                max={1440}
                value={s.dueHours}
                onChange={(e) => patch({ dueHours: e.target.value })}
                className={ctl}
              />
            </label>
          )}
        </div>
      );
    case "wait":
      return (
        <div className="mt-2 flex gap-3">
          <label className={label}>
            Days
            <input
              type="number"
              min={0}
              max={60}
              value={s.waitDays}
              onChange={(e) => patch({ waitDays: e.target.value })}
              className={`${field} w-24`}
            />
          </label>
          <label className={label}>
            Hours
            <input
              type="number"
              min={0}
              max={1440}
              value={s.waitHours}
              onChange={(e) => patch({ waitHours: e.target.value })}
              className={`${field} w-24`}
            />
          </label>
        </div>
      );
    case "stop_if_replied":
      return (
        <p className="text-ink-muted mt-2 text-xs">
          Ends the run if the customer has written since it started.
        </p>
      );
    case "send_email":
    case "send_whatsapp":
      return (
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <label className={label}>
            Template name
            <input
              value={s.template}
              onChange={(e) => patch({ template: e.target.value })}
              maxLength={100}
              className={ctl}
            />
          </label>
          <label className={label}>
            Kind of message
            <select
              value={s.purpose}
              onChange={(e) => patch({ purpose: e.target.value })}
              className={ctl}
            >
              <option value="service">
                Service (a student&apos;s course message)
              </option>
              <option value="marketing">
                Marketing (needs the person&apos;s consent)
              </option>
            </select>
          </label>
          <p className="text-ink-muted text-xs sm:col-span-2">
            Sending isn&apos;t connected yet: until it is, this step stops the
            run with a clear message in its log.
          </p>
        </div>
      );
  }
}
