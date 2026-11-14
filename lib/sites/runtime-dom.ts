// Browser half of public/site/runtime.js. Inlined after runtime-core.ts by
// scripts/build-runtime.ts. Builds DOM with createElement/textContent only;
// data-settings is untrusted and validated by parseSettings.
import { FIRST, animEnabled, buildPayload, buttonTarget, checkoutSuccess, cookieValue, cookiesToWrite, countdownParts, failure, formSuccess, langOf, parseSettings, popupShouldOpen, t } from "./runtime-core.ts";
import type { FormSettings, Outcome } from "./runtime-core.ts";

const $$ = (sel: string, root: ParentNode = document): HTMLElement[] => Array.from(root.querySelectorAll<HTMLElement>(sel));
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: (Node | string)[]) => {
  const e = document.createElement(tag);
  Object.assign(e, props);
  e.append(...kids);
  return e;
};
const meta = (n: string) => document.querySelector<HTMLMetaElement>(`meta[name="${n}"]`)?.content ?? "";
const lang = langOf(document.documentElement.lang);

function attribution() {
  for (const c of cookiesToWrite(cookieValue(document.cookie, FIRST), location.href, document.referrer || null, new Date())) {
    document.cookie = c;
  }
}

function beacon() {
  const pageId = meta("lead-page");
  if (!pageId) return;
  const body = JSON.stringify({ pageId, variant: meta("lead-variant") || "A" });
  try {
    if (navigator.sendBeacon?.("/api/site/view", new Blob([body], { type: "application/json" }))) return;
  } catch {}
  fetch("/api/site/view", { method: "POST", body, keepalive: true, headers: { "Content-Type": "application/json" } }).catch(() => {});
}

let tsLoad: Promise<void> | null = null;
const loadTurnstile = () =>
  (tsLoad ??= new Promise<void>((ok) => {
    const s = el("script", { src: "https://challenges.cloudflare.com/turnstile/v0/api.js", async: true, onload: () => ok(), onerror: () => ok() });
    document.head.append(s);
  }));

function mountForm(host: HTMLElement, kind: "form" | "order") {
  const s: FormSettings | null = parseSettings(host.dataset.settings, kind);
  if (!s) return;
  const key = crypto.randomUUID();
  const pageId = meta("lead-page");
  const formId = host.dataset.id ?? "";
  const siteKey = host.dataset.turnstile || document.documentElement.dataset.turnstile || "";
  const inputs: Record<string, HTMLInputElement | HTMLTextAreaElement> = {};
  const errs: Record<string, HTMLElement> = {};
  const form = el("div", { className: "lead-form" });

  const info = el("div", { className: "lead-class" });
  if (kind === "order") {
    form.append(info);
    fetch("/api/site/class/" + encodeURIComponent(s.classCode))
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => {
        if (!c || typeof c !== "object") return;
        const status = c.status === "full" ? t(lang, "classFull") : t(lang, c.status === "few_seats" ? "few_seats" : "available");
        const lines = [String(c.name ?? ""), `${t(lang, "dates")}: ${c.startDate ?? ""} – ${c.endDate ?? ""}`, `${t(lang, "price")}: RM ${c.priceMyr ?? ""}`, status];
        info.replaceChildren(...lines.map((l) => el("div", {}, l)));
      })
      .catch(() => {});
  }

  const field = (name: string, type: string, area = false) => {
    const input = area ? el("textarea", { rows: 3 }) : el("input", { type });
    input.name = name;
    input.required = ["fullName", "email", "phone"].includes(name);
    inputs[name] = input;
    const err = el("div", { role: "alert" });
    err.style.color = "#b42318";
    errs[name] = err;
    form.append(el("label", {}, t(lang, name), input), err);
  };
  field("fullName", "text");
  field("email", "email");
  field("phone", "tel");
  if (s.fields.includes("company")) field("companyName", "text");
  if (s.fields.includes("jobTitle")) field("jobTitle", "text");
  if (s.fields.includes("message")) field("message", "", true);

  const consent = el("input", { type: "checkbox", checked: false });
  const consentErr = el("div", { role: "alert" });
  errs.consentMarketing = consentErr;
  form.append(el("label", {}, consent, " " + t(lang, "consent")), consentErr);

  let token = "";
  if (siteKey) {
    const box = el("div");
    form.append(box);
    loadTurnstile().then(() => (window as any).turnstile?.render(box, { sitekey: siteKey, callback: (x: string) => (token = x) }));
  }

  const btn = el("button", { type: "submit" }, host.dataset.button || t(lang, kind === "order" ? "pay" : "submit"));
  const status = el("div", { role: "status" });
  form.append(btn, status);

  const show = (o: Outcome) => {
    if (o.kind === "go") {
      location.assign(o.url);
      return;
    }
    status.replaceChildren(o.text);
    status.style.color = o.ok ? "" : "#b42318";
    if (o.whatsapp) status.append(" ", el("a", { href: o.whatsapp, target: "_blank", rel: "noopener" }, t(lang, "whatsapp")));
    for (const [k, e] of Object.entries(errs)) {
      e.textContent = o.kind === "text" ? o.fields?.[k] ?? "" : "";
      inputs[k]?.setAttribute("aria-invalid", e.textContent ? "true" : "false");
    }
  };

  const submit = async () => {
    if (siteKey && !token) return show({ kind: "text", ok: false, text: t(lang, "captcha") });
    btn.disabled = true;
    status.textContent = t(lang, "sending");
    const v: Record<string, string> = {};
    for (const [k, i] of Object.entries(inputs)) v[k] = i.value.trim();
    const payload = buildPayload(s, { pageId, formId, idempotencyKey: key, landingUrl: location.href, referrer: document.referrer }, v, consent.checked, token || undefined);
    let out: Outcome;
    try {
      const r = await fetch(kind === "order" ? "/api/site/checkout" : "/api/site/form", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await r.json().catch(() => ({}));
      out = r.ok ? (kind === "order" ? checkoutSuccess(lang, body) : formSuccess(lang, body)) : failure(lang, r.status, body);
    } catch {
      out = failure(lang, 0, {});
    }
    show(out);
    // A form that was accepted stays disabled; a failure can be retried (same key replays).
    if (!(out.kind === "go" || (out.kind === "text" && out.ok && kind === "form"))) btn.disabled = false;
    if (out.kind === "text" && !out.ok && siteKey) {
      token = "";
      (window as any).turnstile?.reset();
    }
  };
  form.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") {
      e.preventDefault();
      if (!btn.disabled) btn.click();
    }
  });
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    const bad = Object.values(inputs).find((i) => i.required && !i.checkValidity());
    if (bad) return void bad.reportValidity();
    void submit();
  });
  host.replaceChildren(form);
}

function faq(root: HTMLElement) {
  for (const item of Array.from(root.children) as HTMLElement[]) {
    const [q, ...a] = Array.from(item.children) as HTMLElement[];
    if (!q || !a.length) continue;
    const set = (open: boolean) => {
      q.setAttribute("aria-expanded", String(open));
      a.forEach((x) => (x.hidden = !open));
    };
    q.tabIndex = 0;
    q.setAttribute("role", "button");
    q.style.cursor = "pointer";
    set(false);
    q.addEventListener("click", () => set(q.getAttribute("aria-expanded") !== "true"));
    q.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        q.click();
      }
    });
  }
}

function slider(root: HTMLElement) {
  const slides = Array.from(root.children) as HTMLElement[];
  if (slides.length < 2) return;
  let i = 0;
  const go = (n: number) => {
    i = (n + slides.length) % slides.length;
    slides.forEach((s, k) => (s.hidden = k !== i));
  };
  go(0);
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!reduce) setInterval(() => go(i + 1), 5000);
  root.addEventListener("click", () => go(i + 1));
}

function counter(root: HTMLElement) {
  let to = NaN;
  try {
    to = Number(JSON.parse(root.dataset.settings ?? "").to);
  } catch {}
  if (!isFinite(to)) to = parseFloat((root.textContent ?? "").replace(/,/g, ""));
  if (!isFinite(to)) return;
  const run = () => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return void (root.textContent = to.toLocaleString());
    const t0 = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / 1500);
      root.textContent = Math.round(to * p).toLocaleString();
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  if (!("IntersectionObserver" in window)) return;
  const io = new IntersectionObserver((es) => {
    if (es.some((e) => e.isIntersecting)) {
      io.disconnect();
      run();
    }
  });
  io.observe(root);
}

const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

function anims() {
  const items = $$("[data-anim]");
  if (!items.length || !animEnabled("IntersectionObserver" in window, reduced())) return;
  document.documentElement.classList.add("lead-anim");
  const io = new IntersectionObserver((es) => {
    for (const e of es) if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
  }, { threshold: 0.12 });
  items.forEach((i) => io.observe(i));
}

function countdown(root: HTMLElement) {
  const to = root.dataset.cd ?? "";
  const nums = Array.from(root.querySelectorAll("b"));
  const tick = () => {
    const p = countdownParts(to, Date.now());
    if (p.done) {
      clearInterval(timer);
      if (root.dataset.done) root.textContent = root.dataset.done;
      else nums.forEach((n) => (n.textContent = "0"));
      return;
    }
    [p.d, p.h, p.m, p.s].forEach((v, i) => nums[i] && (nums[i].textContent = String(v).padStart(2, "0")));
  };
  const timer = setInterval(tick, 1000);
  tick();
}

function autoplay(root: HTMLElement) {
  if (reduced()) return;
  setInterval(() => {
    const end = root.scrollLeft + root.clientWidth >= root.scrollWidth - 4;
    root.scrollTo({ left: end ? 0 : root.scrollLeft + root.clientWidth, behavior: "smooth" });
  }, 5000);
}

function countUp(root: HTMLElement) {
  const to = Number(root.dataset.count);
  if (!isFinite(to) || reduced() || !("IntersectionObserver" in window)) return;
  const io = new IntersectionObserver((es) => {
    if (!es.some((e) => e.isIntersecting)) return;
    io.disconnect();
    const t0 = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / 1200);
      root.textContent = String(Math.round(to * p));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  io.observe(root);
}

// sessionStorage may throw (private mode); the Set is the in-memory fallback.
const shown = new Set<string>();
const wasSeen = (id: string) => {
  if (shown.has(id)) return true;
  try { return sessionStorage.getItem("lead_popup_" + id) === "1"; } catch { return false; }
};
const markSeen = (id: string) => {
  shown.add(id);
  try { sessionStorage.setItem("lead_popup_" + id, "1"); } catch {}
};

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])';

function popups() {
  const all = $$('[data-lead="popup"]');
  if (!all.length) return;
  const touch = matchMedia("(hover: none)").matches || matchMedia("(pointer: coarse)").matches;
  let isOpen = false;

  const open = (box: HTMLElement, opener: Element | null) => {
    if (isOpen) return;
    isOpen = true;
    markSeen(box.dataset.id ?? "");
    const x = el("button", { type: "button", className: "lead-pop-x" }, "×");
    x.setAttribute("aria-label", "Close");
    const dialog = el("div", { className: "lead-pop-dlg", tabIndex: -1 }, x);
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.append(...Array.from(box.childNodes));
    const back = el("div", { className: "lead-pop" }, dialog);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return close();
      if (e.key !== "Tab") return;
      const f = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (!f.length) return e.preventDefault();
      const first = f[0], last = f[f.length - 1], a = document.activeElement;
      if (e.shiftKey && (a === first || a === dialog)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && a === last) { e.preventDefault(); first.focus(); }
    };
    function close() {
      document.removeEventListener("keydown", onKey, true);
      box.append(...Array.from(dialog.childNodes).filter((n) => n !== x));
      back.remove();
      isOpen = false;
      (opener as HTMLElement | null)?.focus?.();
    }
    x.addEventListener("click", close);
    back.addEventListener("mousedown", (e) => { if (e.target === back) close(); });
    document.addEventListener("keydown", onKey, true);
    document.body.append(back);
    dialog.focus();
  };

  const ids = all.map((p) => p.dataset.id ?? "");
  document.addEventListener("click", (e) => {
    const a = (e.target as Element).closest?.<HTMLElement>("[data-action]");
    if (!a) return;
    const tg = buttonTarget(a.dataset.action, { popupIds: ids });
    if (tg.kind !== "popup") return;
    e.preventDefault();
    const box = all.find((p) => p.dataset.id === tg.value);
    if (box) open(box, a);
  });

  const t0 = Date.now();
  const tryOpen = (box: HTMLElement, exitIntent: boolean) => {
    const st = { touch, elapsedSec: (Date.now() - t0) / 1000, exitIntent, seen: wasSeen(box.dataset.id ?? ""), delaySec: Number(box.dataset.delay) || 0 };
    if (popupShouldOpen(box.dataset.trigger ?? "", st)) open(box, document.activeElement);
  };
  for (const box of all) {
    if (box.dataset.trigger === "timer") setTimeout(() => tryOpen(box, false), (Number(box.dataset.delay) || 0) * 1000);
  }
  if (!touch) {
    document.addEventListener("mouseout", (e) => {
      if (e.relatedTarget || e.clientY > 0) return;
      for (const box of all) if (box.dataset.trigger === "exit") tryOpen(box, true);
    });
  }
}

function init() {
  attribution();
  beacon();
  $$('[data-lead="form"]').forEach((e) => mountForm(e, "form"));
  $$('[data-lead="order"]').forEach((e) => mountForm(e, "order"));
  $$('[data-lead="faq"]').forEach(faq);
  $$('[data-lead="slider"]').forEach(slider);
  $$('[data-lead="counter"]').forEach(counter);
  $$("[data-count]").forEach(countUp);
  $$(".e-cd[data-cd]").forEach(countdown);
  $$('.e-sl[data-autoplay="1"]').forEach(autoplay);
  popups();
  anims();
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
