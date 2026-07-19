"use client";

import {
  FormEvent,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";
const ACCOUNTS_KEY = "aicount_accounts_v2";
const ACTIVE_ACCOUNT_KEY = "aicount_active_account_v2";
const AUTH_EXPIRED_EVENT = "aicount:auth-expired";
const AUTH_EXPIRED_MESSAGE =
  "Phiên đăng nhập đã hết hạn hoặc không còn hợp lệ. Vui lòng đăng nhập lại.";

type Json = Record<string, any>;
type Theme = "system" | "light" | "dark";
type View =
  | "overview"
  | "invoices"
  | "files"
  | "reviews"
  | "legal"
  | "audit"
  | "settings";
type InspectorTab = "overview" | "evidence" | "history";
type LegalPanel = "preview" | "search";
type User = {
  id: string;
  email: string;
  full_name: string;
  roles: string[];
  tenant_id: string;
  tenant_name?: string;
};
type AccountSession = { token: string; user: User };

function tokenExpiryMs(token: string) {
  try {
    const encoded = token.split(".")[1];
    if (!encoded) return null;
    const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(
      window.atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")),
    ) as { exp?: unknown };
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

function reportExpiredSession(token: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(AUTH_EXPIRED_EVENT, { detail: { token } }),
  );
}

function searchable(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function legalDomainLabel(value: unknown) {
  const labels: Record<string, string> = {
    ai_governance: "Quản trị AI",
    data_governance: "Quản trị dữ liệu",
    digital_technology: "Công nghệ số",
    cybersecurity: "An ninh mạng",
    accounting: "Kế toán",
    accounting_tax_amendments: "Sửa đổi kế toán / thuế",
    invoice: "Hóa đơn",
    electronic_transactions: "Giao dịch điện tử",
    personal_data: "Dữ liệu cá nhân",
    tax_administration: "Quản lý thuế",
    corporate_income_tax: "Thuế TNDN",
    vat: "Thuế GTGT",
    sanctions: "Chế tài",
  };
  return labels[String(value ?? "")] ?? String(value ?? "Khác");
}

async function request(path: string, token?: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData))
    headers.set("content-type", "application/json");
  const response = await fetch(`${API}${path}`, { ...init, headers });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && token) {
    reportExpiredSession(token);
    throw new Error(AUTH_EXPIRED_MESSAGE);
  }
  if (!response.ok)
    throw new Error(data.message ?? data.detail ?? `HTTP ${response.status}`);
  return data;
}

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    logo: (
      <>
        <path d="M4.5 7.5 12 3l7.5 4.5v9L12 21l-7.5-4.5z" />
        <path d="m8.5 10 3.5-2 3.5 2v4L12 16l-3.5-2z" />
      </>
    ),
    inbox: (
      <>
        <path d="M4 4h16v12H4z" />
        <path d="M4 13h4l2 3h4l2-3h4" />
      </>
    ),
    chart: (
      <>
        <path d="M4 20V10m6 10V4m6 16v-7m4 7H2" />
        <path d="m4 8 6-5 6 8 4-4" />
      </>
    ),
    review: (
      <>
        <path d="M9 5H6a2 2 0 0 0-2 2v12h16V7a2 2 0 0 0-2-2h-3" />
        <path d="M9 3h6v4H9zM8 12l2 2 5-5" />
      </>
    ),
    shield: (
      <>
        <path d="M12 3 5 6v5c0 4.6 2.9 8.2 7 10 4.1-1.8 7-5.4 7-10V6z" />
        <path d="m9 12 2 2 4-4" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" />
      </>
    ),
    sun: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </>
    ),
    moon: <path d="M20 15.7A8.5 8.5 0 0 1 8.3 4 8.5 8.5 0 1 0 20 15.7Z" />,
    monitor: (
      <>
        <rect x="3" y="4" width="18" height="13" rx="2" />
        <path d="M8 21h8m-4-4v4" />
      </>
    ),
    book: (
      <>
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z" />
        <path d="M8 7h8m-8 4h6" />
      </>
    ),
    edit: (
      <>
        <path d="m4 16-1 5 5-1L19 9l-4-4z" />
        <path d="m13 7 4 4" />
      </>
    ),
    search: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-4-4" />
      </>
    ),
    upload: (
      <>
        <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" />
        <path d="M5 14v5h14v-5" />
      </>
    ),
    chevron: <path d="m9 7 5 5-5 5" />,
    more: (
      <>
        <circle cx="5" cy="12" r="1" fill="currentColor" />
        <circle cx="12" cy="12" r="1" fill="currentColor" />
        <circle cx="19" cy="12" r="1" fill="currentColor" />
      </>
    ),
    spark: (
      <>
        <path d="m12 3 1.2 4.1L17 9l-3.8 1.9L12 15l-1.2-4.1L7 9l3.8-1.9z" />
        <path d="m18.5 15 .6 2.1L21 18l-1.9.9-.6 2.1-.6-2.1L16 18l1.9-.9z" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    plus: <path d="M12 5v14M5 12h14" />,
    logout: (
      <>
        <path d="M10 5H5v14h5M14 8l4 4-4 4m4-4H9" />
      </>
    ),
    file: (
      <>
        <path d="M6 3h8l4 4v14H6z" />
        <path d="M14 3v5h4M9 13h6m-6 4h4" />
      </>
    ),
    folder: (
      <>
        <path d="M3 6h7l2 2h9v11H3z" />
        <path d="M3 10h18" />
      </>
    ),
    download: (
      <>
        <path d="M12 3v12m0 0 4-4m-4 4-4-4" />
        <path d="M5 19h14" />
      </>
    ),
    trash: (
      <>
        <path d="M4 7h16M9 7V4h6v3m3 0-1 14H7L6 7" />
        <path d="M10 11v6m4-6v6" />
      </>
    ),
    arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
  };
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

const initials = (name?: string) =>
  (name || "A")
    .split(/\s+/)
    .slice(-2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
const money = (value?: number, currency = "VND") =>
  value == null
    ? "—"
    : new Intl.NumberFormat("vi-VN", {
        style: "currency",
        currency,
        maximumFractionDigits: 0,
      }).format(value);
const date = (value?: string) =>
  value
    ? new Intl.DateTimeFormat("vi-VN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      }).format(new Date(value))
    : "—";
const dateTime = (value?: string | number | null) =>
  value
    ? new Intl.DateTimeFormat("vi-VN", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(value))
    : "—";
const localIsoDate = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 10);
};
const bytes = (value = 0) => {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(1)} GB`;
};

function Status({ value }: { value?: string }) {
  const key = (value || "UNKNOWN").toLowerCase();
  const labels: Record<string, string> = {
    extracted: "Đã trích xuất",
    needs_review: "Cần duyệt",
    human_approved: "Đã duyệt",
    rejected: "Từ chối",
    escalated: "Chuyển cấp",
    pending: "Đang chờ",
    accepted: "Đã chấp nhận",
    pass_technical_checks: "Đạt kiểm tra kỹ thuật",
    verified_pdf_text: "PDF đã xác minh",
    insufficient_legal_evidence: "Chưa đủ căn cứ",
    ocr_or_index_required: "Cần OCR / lập chỉ mục",
  };
  return (
    <span className={`status status-${key}`}>
      {labels[key] ?? value ?? "Chưa rõ"}
    </span>
  );
}

export default function Home() {
  const [ready, setReady] = useState(false);
  const [accounts, setAccounts] = useState<AccountSession[]>([]);
  const [activeId, setActiveId] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [addAccount, setAddAccount] = useState(false);
  const [theme, setTheme] = useState<Theme>("system");
  const [view, setView] = useState<View>("overview");
  const [items, setItems] = useState<Json[]>([]);
  const [files, setFiles] = useState<Json[]>([]);
  const [fileUsage, setFileUsage] = useState({ used: 0, quota: 1, total: 0 });
  const [fileFilter, setFileFilter] = useState("all");
  const [reviews, setReviews] = useState<Json[]>([]);
  const [audit, setAudit] = useState<Json[]>([]);
  const [auditVerify, setAuditVerify] = useState<Json | null>(null);
  const [legalQuery, setLegalQuery] = useState("hóa đơn điện tử");
  const [legalResults, setLegalResults] = useState<Json[]>([]);
  const [legalCorpus, setLegalCorpus] = useState<Json | null>(null);
  const [legalAssessment, setLegalAssessment] = useState<Json | null>(null);
  const [legalEffectiveOn, setLegalEffectiveOn] = useState(localIsoDate);
  const [legalGroundedOnly, setLegalGroundedOnly] = useState(true);
  const [legalDomain, setLegalDomain] = useState("");
  const [legalDocuments, setLegalDocuments] = useState<Json[]>([]);
  const [legalDocumentFilter, setLegalDocumentFilter] = useState("");
  const [selectedLegalDocument, setSelectedLegalDocument] =
    useState<Json | null>(null);
  const [legalPanel, setLegalPanel] = useState<LegalPanel>("preview");
  const [legalPreviewPage, setLegalPreviewPage] = useState<number | null>(null);
  const [legalPdfUrl, setLegalPdfUrl] = useState("");
  const [legalPdfError, setLegalPdfError] = useState("");
  const [legalPdfLoading, setLegalPdfLoading] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [commandIndex, setCommandIndex] = useState(0);
  const [selected, setSelected] = useState<Json | null>(null);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("overview");
  const [evidence, setEvidence] = useState<Json | null>(null);
  const [correcting, setCorrecting] = useState(false);
  const [correction, setCorrection] = useState({
    field_name: "invoice_number",
    value: "",
    reason: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [lastResult, setLastResult] = useState<Json | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const uploadRef = useRef<HTMLInputElement>(null);
  const fileUploadRef = useRef<HTMLInputElement>(null);
  const commandInputRef = useRef<HTMLInputElement>(null);

  const account = accounts.find((item) => item.user.id === activeId);
  const token = account?.token ?? "";

  useEffect(() => {
    try {
      const saved = JSON.parse(
        sessionStorage.getItem(ACCOUNTS_KEY) ?? "[]",
      ) as AccountSession[];
      const savedId =
        sessionStorage.getItem(ACTIVE_ACCOUNT_KEY) ?? saved[0]?.user.id ?? "";
      setAccounts(saved);
      setActiveId(savedId);
    } catch {
      sessionStorage.removeItem(ACCOUNTS_KEY);
      sessionStorage.removeItem(ACTIVE_ACCOUNT_KEY);
    }
    const savedTheme = localStorage.getItem("aicount_theme");
    setTheme(
      savedTheme === "light" || savedTheme === "dark" ? savedTheme : "system",
    );
    setReady(true);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!correcting && !addAccount) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (correcting) setCorrecting(false);
      if (addAccount) setAddAccount(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [correcting, addAccount]);

  const saveAccounts = (
    next: AccountSession[],
    nextActive = next[0]?.user.id ?? "",
  ) => {
    setAccounts(next);
    setActiveId(nextActive);
    sessionStorage.setItem(ACCOUNTS_KEY, JSON.stringify(next));
    if (nextActive) sessionStorage.setItem(ACTIVE_ACCOUNT_KEY, nextActive);
    else sessionStorage.removeItem(ACTIVE_ACCOUNT_KEY);
  };

  const clearWorkspace = useCallback(() => {
    setItems([]);
    setFiles([]);
    setFileUsage({ used: 0, quota: 1, total: 0 });
    setReviews([]);
    setAudit([]);
    setAuditVerify(null);
    setLegalResults([]);
    setLegalCorpus(null);
    setLegalAssessment(null);
    setLegalDocuments([]);
    setSelectedLegalDocument(null);
    setLegalPdfUrl("");
    setCommandOpen(false);
    setSelected(null);
    setEvidence(null);
    setCorrecting(false);
    setLastResult(null);
    setAddAccount(false);
    setView("overview");
    setBusy(false);
    setToast("");
  }, []);

  const expireSession = useCallback(
    (expiredToken: string) => {
      const expired = accounts.find((item) => item.token === expiredToken);
      if (!expired) return;

      const next = accounts.filter((item) => item.token !== expiredToken);
      setAccounts(next);
      sessionStorage.setItem(ACCOUNTS_KEY, JSON.stringify(next));

      if (expired.user.id !== activeId) return;
      setActiveId("");
      sessionStorage.removeItem(ACTIVE_ACCOUNT_KEY);
      setEmail(expired.user.email);
      setPassword("");
      clearWorkspace();
      setError(AUTH_EXPIRED_MESSAGE);
    },
    [accounts, activeId, clearWorkspace],
  );

  useEffect(() => {
    const handleExpiredSession = (event: Event) => {
      const expiredToken = (event as CustomEvent<{ token?: string }>).detail
        ?.token;
      if (expiredToken) expireSession(expiredToken);
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, handleExpiredSession);
    return () =>
      window.removeEventListener(AUTH_EXPIRED_EVENT, handleExpiredSession);
  }, [expireSession]);

  useEffect(() => {
    if (!token) return;
    const expiresAt = tokenExpiryMs(token);
    if (expiresAt === null) return;

    const expireIfNeeded = () => {
      if (Date.now() >= expiresAt) expireSession(token);
    };
    if (Date.now() >= expiresAt) {
      expireSession(token);
      return;
    }

    const timer = window.setTimeout(expireIfNeeded, expiresAt - Date.now());
    const handleVisibility = () => {
      if (document.visibilityState === "visible") expireIfNeeded();
    };
    window.addEventListener("focus", expireIfNeeded);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", expireIfNeeded);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [token, expireSession]);

  const loadInvoices = useCallback(async (sessionToken: string) => {
    const data = await request("/invoices?limit=200", sessionToken);
    setItems(data.items ?? []);
    setSelected((old) =>
      old
        ? (data.items.find((item: Json) => item.id === old.id) ??
          data.items[0] ??
          null)
        : (data.items[0] ?? null),
    );
  }, []);
  const loadFiles = useCallback(
    async (sessionToken: string, category = "all") => {
      const data = await request(
        `/files?limit=200&category=${encodeURIComponent(category)}`,
        sessionToken,
      );
      setFiles(data.items ?? []);
      setFileUsage({
        used: data.used_bytes ?? 0,
        quota: data.quota_bytes ?? 1,
        total: data.total ?? 0,
      });
    },
    [],
  );
  const loadLegalDocuments = useCallback(async (sessionToken: string) => {
    const data = await request("/legal/documents", sessionToken);
    const documents = data.items ?? [];
    setLegalDocuments(documents);
    setSelectedLegalDocument((current) =>
      current
        ? (documents.find((item: Json) => item.id === current.id) ??
          documents[0] ??
          null)
        : (documents[0] ?? null),
    );
  }, []);

  useEffect(() => {
    if (!token) return;
    setItems([]);
    setSelected(null);
    setLastResult(null);
    setError("");
    setBusy(true);
    loadInvoices(token)
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));
  }, [activeId, token, loadInvoices]);

  useEffect(() => {
    if (token && view === "legal") {
      setBusy(true);
      Promise.all([
        request("/legal/corpus/status", token),
        loadLegalDocuments(token),
      ])
        .then(([status]) => setLegalCorpus(status))
        .catch((e) => setError(e.message))
        .finally(() => setBusy(false));
      return;
    }
    if (token && view === "overview") {
      setBusy(true);
      Promise.all([
        request("/legal/corpus/status", token),
        loadFiles(token, "all"),
      ])
        .then(([status]) => setLegalCorpus(status))
        .catch((e) => setError(e.message))
        .finally(() => setBusy(false));
      return;
    }
    if (token && view === "settings") {
      setBusy(true);
      Promise.all([
        loadFiles(token, "all"),
        request("/legal/corpus/status", token),
        loadLegalDocuments(token),
      ])
        .then(([, status]) => setLegalCorpus(status))
        .catch((e) => setError(e.message))
        .finally(() => setBusy(false));
      return;
    }
    if (token && view === "files") {
      setBusy(true);
      loadFiles(token, fileFilter)
        .catch((e) => setError(e.message))
        .finally(() => setBusy(false));
      return;
    }
    if (
      !token ||
      view === "overview" ||
      view === "invoices" ||
      view === "files" ||
      view === "legal"
    )
      return;
    const path = view === "reviews" ? "/reviews" : "/audit/events?limit=100";
    setBusy(true);
    request(path, token)
      .then((data) => {
        if (view === "reviews") setReviews(data.items ?? []);
        else {
          setAudit(data.items ?? []);
          request("/audit/verify", token)
            .then(setAuditVerify)
            .catch(() => setAuditVerify(null));
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));
  }, [view, token, fileFilter, loadFiles, loadLegalDocuments]);

  useEffect(() => {
    if (!commandOpen || !token || legalDocuments.length) return;
    loadLegalDocuments(token).catch(() => undefined);
  }, [commandOpen, token, legalDocuments.length, loadLegalDocuments]);

  useEffect(() => {
    if (!token || !selectedLegalDocument) {
      setLegalPdfUrl("");
      return;
    }
    const controller = new AbortController();
    let objectUrl = "";
    setLegalPdfLoading(true);
    setLegalPdfError("");
    fetch(`${API}/legal/documents/${selectedLegalDocument.id}/pdf`, {
      headers: { authorization: `Bearer ${token}` },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 401) {
          reportExpiredSession(token);
          throw new Error(AUTH_EXPIRED_MESSAGE);
        }
        if (!response.ok)
          throw new Error(`Không thể tải PDF (HTTP ${response.status})`);
        const blob = await response.blob();
        if (!blob.type.includes("pdf"))
          throw new Error("Nguồn preview không phải tệp PDF hợp lệ.");
        objectUrl = URL.createObjectURL(blob);
        setLegalPdfUrl(objectUrl);
      })
      .catch((reason) => {
        if (reason?.name !== "AbortError") setLegalPdfError(reason.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLegalPdfLoading(false);
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [token, selectedLegalDocument]);

  async function login(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = await request("/auth/login", undefined, {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      const nextSession: AccountSession = {
        token: data.access_token,
        user: data.user,
      };
      const next = [
        ...accounts.filter((item) => item.user.id !== data.user.id),
        nextSession,
      ];
      saveAccounts(next, data.user.id);
      setEmail("");
      setPassword("");
      setAddAccount(false);
      setView("overview");
      setToast(`Đã chuyển sang ${data.user.full_name}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function switchAccount(id: string) {
    setActiveId(id);
    sessionStorage.setItem(ACTIVE_ACCOUNT_KEY, id);
    setView("overview");
    const target = accounts.find((item) => item.user.id === id);
    if (target) setToast(`Đã chuyển sang ${target.user.full_name}`);
  }

  function logoutCurrent() {
    if (!account) return;
    const next = accounts.filter((item) => item.user.id !== account.user.id);
    saveAccounts(next);
    setItems([]);
    setSelected(null);
  }

  function applyTheme(next: Theme) {
    setTheme(next);
    if (next === "system") {
      document.documentElement.removeAttribute("data-theme");
      document.documentElement.style.removeProperty("color-scheme");
      localStorage.removeItem("aicount_theme");
    } else {
      document.documentElement.dataset.theme = next;
      document.documentElement.style.colorScheme = next;
      localStorage.setItem("aicount_theme", next);
    }
  }

  function toggleTheme() {
    applyTheme(
      theme === "system" ? "light" : theme === "light" ? "dark" : "system",
    );
  }

  async function uploadFile(file?: File) {
    if (!file || !token) return;
    const body = new FormData();
    body.append("file", file);
    setBusy(true);
    setError("");
    try {
      const data = await request("/invoices", token, { method: "POST", body });
      setSelected(data);
      setLastResult({
        message: "Đã lưu bản gốc và trích xuất dữ liệu.",
        document: data.document,
      });
      await loadInvoices(token);
      setToast("Tải hóa đơn lên thành công");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (uploadRef.current) uploadRef.current.value = "";
    }
  }

  async function uploadStoredFile(file?: File) {
    if (!file || !token) return;
    const body = new FormData();
    body.append("file", file);
    setBusy(true);
    setError("");
    try {
      await request("/files", token, { method: "POST", body });
      await loadFiles(token, fileFilter);
      setToast("Đã lưu tệp vào kho cá nhân");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (fileUploadRef.current) fileUploadRef.current.value = "";
    }
  }

  async function downloadStoredFile(file: Json) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${API}/files/${file.id}/download`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (response.status === 401) {
        reportExpiredSession(token);
        throw new Error(AUTH_EXPIRED_MESSAGE);
      }
      if (!response.ok) throw new Error("Không thể tải tệp xuống");
      const url = URL.createObjectURL(await response.blob()),
        anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.filename;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function editStoredFile(file: Json) {
    const description = window.prompt("Mô tả tệp", file.description ?? "");
    if (description === null) return;
    const tagsText = window.prompt(
      "Nhãn, phân cách bằng dấu phẩy",
      (file.tags ?? []).join(", "),
    );
    if (tagsText === null) return;
    setBusy(true);
    setError("");
    try {
      await request(`/files/${file.id}`, token, {
        method: "PATCH",
        body: JSON.stringify({
          description,
          tags: tagsText
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean),
        }),
      });
      await loadFiles(token, fileFilter);
      setToast("Đã cập nhật thông tin tệp");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteStoredFile(file: Json) {
    if (!window.confirm(`Xóa vĩnh viễn “${file.filename}”?`)) return;
    setBusy(true);
    setError("");
    try {
      await request(`/files/${file.id}`, token, { method: "DELETE" });
      await loadFiles(token, fileFilter);
      setToast("Đã xóa tệp");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function action(kind: "validate" | "reconcile" | "score") {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      const body =
        kind === "reconcile"
          ? { purchase_order: null, goods_receipt: null, payment: null }
          : {};
      const data = await request(`/invoices/${selected.id}/${kind}`, token, {
        method: "POST",
        body: JSON.stringify(body),
      });
      setLastResult(data);
      await loadInvoices(token);
      setToast(
        kind === "validate"
          ? "Đã chạy bộ quy tắc"
          : kind === "score"
            ? "Đã cập nhật điểm rủi ro"
            : "Đã hoàn tất đối chiếu",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function showEvidence() {
    if (!selected || !token) return;
    setInspectorTab("evidence");
    setBusy(true);
    setError("");
    try {
      setEvidence(await request(`/invoices/${selected.id}/evidence`, token));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function searchLegal(event?: FormEvent) {
    event?.preventDefault();
    if (!token || legalQuery.trim().length < 2) return;
    setLegalPanel("search");
    setBusy(true);
    setError("");
    try {
      const data = await request(
        `/legal/search?q=${encodeURIComponent(legalQuery.trim())}&effective_on=${legalEffectiveOn}&grounded_only=${legalGroundedOnly}&domain=${encodeURIComponent(legalDomain)}&limit=20`,
        token,
      );
      setLegalResults(data.results ?? []);
      setLegalAssessment(data.assessment ?? null);
      setLegalCorpus((current) => ({
        ...(current ?? {}),
        ...(data.corpus_status ?? {}),
      }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function submitCorrection(event: FormEvent) {
    event.preventDefault();
    if (!selected || !token) return;
    const numericFields = new Set([
      "subtotal",
      "tax_amount",
      "fees",
      "discounts",
      "total_amount",
      "extraction_confidence",
    ]);
    setBusy(true);
    setError("");
    try {
      const result = await request(`/invoices/${selected.id}/fields`, token, {
        method: "PATCH",
        body: JSON.stringify({
          ...correction,
          value: numericFields.has(correction.field_name)
            ? Number(correction.value)
            : correction.value,
        }),
      });
      setLastResult(result);
      setCorrecting(false);
      await loadInvoices(token);
      setToast("Đã lưu hiệu chỉnh và tạo phiếu duyệt");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function decide(decision: "ACCEPTED" | "REJECTED" | "ESCALATED") {
    let reviewId = lastResult?.review_id;
    if (!reviewId && selected)
      reviewId = reviews.find(
        (item) => item.invoice_id === selected.id && item.status === "PENDING",
      )?.id;
    if (!reviewId) {
      setError("Hãy chạy kiểm tra hoặc chấm điểm để tạo phiếu duyệt trước.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const data = await request(`/reviews/${reviewId}/decisions`, token, {
        method: "POST",
        body: JSON.stringify({
          decision,
          comment: "Quyết định được xác nhận từ AICount Guard Web.",
        }),
      });
      setLastResult(data);
      await loadInvoices(token);
      setToast(
        decision === "ACCEPTED"
          ? "Đã chấp nhận hóa đơn"
          : decision === "REJECTED"
            ? "Đã từ chối hóa đơn"
            : "Đã chuyển cấp xử lý",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const alerts = useMemo(
    () =>
      lastResult?.alerts ??
      lastResult?.anomaly?.alerts ??
      selected?.validation_result?.alerts ??
      [],
    [lastResult, selected],
  );
  const ruleDecision =
    lastResult?.decision ?? selected?.validation_result?.decision ?? null;
  const filtered = useMemo(
    () =>
      items.filter((item) => {
        const text =
          `${item.invoice_number ?? ""} ${item.normalized_data?.seller_name ?? ""} ${item.seller_tax_code ?? ""}`.toLowerCase();
        const filterMatch =
          filter === "all" ||
          (filter === "risk"
            ? Number(item.risk_result?.score ?? 0) >= 30
            : item.status === filter);
        return text.includes(query.toLowerCase()) && filterMatch;
      }),
    [items, query, filter],
  );
  const stats = useMemo(
    () => ({
      total: items.length,
      review: items.filter((item) => item.status === "NEEDS_REVIEW").length,
      risk: items.filter((item) => Number(item.risk_result?.score ?? 0) >= 60)
        .length,
      approved: items.filter((item) => item.status === "HUMAN_APPROVED").length,
    }),
    [items],
  );
  const sessionExpiresAt = token ? tokenExpiryMs(token) : null;
  const sessionRemainingMinutes = sessionExpiresAt
    ? Math.max(0, Math.ceil((sessionExpiresAt - Date.now()) / 60_000))
    : null;
  const dashboard = useMemo(() => {
    const riskBands = { low: 0, medium: 0, high: 0 };
    let riskTotal = 0;
    let riskSamples = 0;
    for (const item of items) {
      const score = Number(item.risk_result?.score);
      if (!Number.isFinite(score)) continue;
      riskSamples += 1;
      riskTotal += score;
      if (score >= 60) riskBands.high += 1;
      else if (score >= 30) riskBands.medium += 1;
      else riskBands.low += 1;
    }

    const activity = Array.from({ length: 7 }, (_, index) => {
      const value = new Date();
      value.setHours(0, 0, 0, 0);
      value.setDate(value.getDate() - (6 - index));
      const key = value.toISOString().slice(0, 10);
      return {
        key,
        label: new Intl.DateTimeFormat("vi-VN", {
          weekday: "short",
          day: "2-digit",
        }).format(value),
        count: items.filter((item) =>
          String(item.created_at ?? "").startsWith(key),
        ).length,
      };
    });

    return {
      riskBands,
      averageRisk: riskSamples ? Math.round(riskTotal / riskSamples) : 0,
      riskSamples,
      activity,
      maxActivity: Math.max(1, ...activity.map((item) => item.count)),
      completedRate: stats.total
        ? Math.round((stats.approved / stats.total) * 100)
        : 0,
      reviewRate: stats.total
        ? Math.round((stats.review / stats.total) * 100)
        : 0,
      other: Math.max(0, stats.total - stats.approved - stats.review),
    };
  }, [items, stats]);
  const filteredLegalDocuments = useMemo(() => {
    const needle = searchable(legalDocumentFilter.trim());
    return legalDocuments.filter((document) =>
      searchable(
        `${document.number} ${document.title} ${document.domain} ${document.use}`,
      ).includes(needle),
    );
  }, [legalDocuments, legalDocumentFilter]);
  const commandItems = useMemo(() => {
    const commands = [
      {
        id: "view-overview",
        category: "Đi tới",
        label: "Tổng quan hệ thống",
        detail: "Biểu đồ vận hành, rủi ro và trạng thái xử lý",
        icon: "chart",
        run: () => setView("overview"),
      },
      {
        id: "view-invoices",
        category: "Đi tới",
        label: "Hóa đơn",
        detail: "Mở hàng đợi xử lý hóa đơn",
        icon: "inbox",
        run: () => setView("invoices"),
      },
      {
        id: "view-legal",
        category: "Đi tới",
        label: "Thư viện pháp lý",
        detail: `${legalDocuments.length || 31} văn bản PDF`,
        icon: "book",
        run: () => setView("legal"),
      },
      {
        id: "view-reviews",
        category: "Đi tới",
        label: "Hàng chờ duyệt",
        detail: "Các quyết định cần con người xác nhận",
        icon: "review",
        run: () => setView("reviews"),
      },
      {
        id: "view-audit",
        category: "Đi tới",
        label: "Nhật ký kiểm toán",
        detail: "Theo dõi chuỗi sự kiện bất biến",
        icon: "shield",
        run: () => setView("audit"),
      },
      {
        id: "action-upload",
        category: "Lệnh",
        label: "Tải hóa đơn mới",
        detail: "Chọn XML, PDF hoặc ảnh",
        icon: "upload",
        run: () => uploadRef.current?.click(),
      },
      {
        id: "action-theme",
        category: "Lệnh",
        label: "Chuyển giao diện sáng / tối",
        detail: `Hiện tại: ${theme}`,
        icon: "sun",
        run: toggleTheme,
      },
      ...items.slice(0, 30).map((invoice) => ({
        id: `invoice-${invoice.id}`,
        category: "Hóa đơn",
        label: invoice.invoice_number || "Hóa đơn chưa có số",
        detail: `${invoice.normalized_data?.seller_name ?? "Không rõ người bán"} · ${invoice.status}`,
        icon: "file",
        run: () => {
          setSelected(invoice);
          setView("invoices");
        },
      })),
      ...legalDocuments.map((document) => ({
        id: `legal-${document.id}`,
        category: "Văn bản pháp lý",
        label: document.number,
        detail: document.title,
        icon: "book",
        run: () => {
          setSelectedLegalDocument(document);
          setLegalPreviewPage(null);
          setLegalPanel("preview");
          setView("legal");
        },
      })),
    ];
    const needle = searchable(commandQuery.replace(/^>/, "").trim());
    const commandOnly = commandQuery.trimStart().startsWith(">");
    return commands
      .filter(
        (item) =>
          (!commandOnly || item.category === "Lệnh") &&
          (!needle ||
            searchable(
              `${item.label} ${item.detail} ${item.category}`,
            ).includes(needle)),
      )
      .slice(0, 18);
  }, [commandQuery, items, legalDocuments, theme]);

  function executeCommand(item?: (typeof commandItems)[number]) {
    if (!item) return;
    item.run();
    setCommandOpen(false);
    setCommandQuery("");
  }

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && ["k", "p"].includes(event.key.toLowerCase())) {
        event.preventDefault();
        setCommandQuery(
          event.shiftKey && event.key.toLowerCase() === "p" ? ">" : "",
        );
        setCommandOpen(true);
      } else if (event.key === "Escape" && commandOpen) {
        setCommandOpen(false);
      }
    };
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, [commandOpen]);

  useEffect(() => {
    if (!commandOpen) return;
    setCommandIndex(0);
    window.setTimeout(() => commandInputRef.current?.focus(), 0);
  }, [commandOpen, commandQuery]);

  const loginCard = (compact = false) => (
    <form
      className={compact ? "login-form compact" : "login-form"}
      onSubmit={login}
    >
      <div className="form-heading">
        <div className="eyebrow">
          {compact ? "TÀI KHOẢN MỚI" : "WELCOME BACK"}
        </div>
        <h1>{compact ? "Thêm tài khoản" : "Đăng nhập AICount"}</h1>
        <p>
          {compact
            ? "Tài khoản được lưu thành một phiên riêng biệt."
            : "Đăng nhập để tiếp tục kiểm tra hóa đơn."}
        </p>
      </div>
      <label>
        Email công việc
        <input
          autoFocus={compact}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          type="email"
          placeholder="ban@congty.vn"
          autoComplete="email"
          required
        />
      </label>
      <label>
        Mật khẩu
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          type="password"
          placeholder="Tối thiểu 8 ký tự"
          autoComplete="current-password"
          minLength={8}
          required
        />
      </label>
      {error && (
        <div className="inline-error">
          <Icon name="close" size={15} />
          {error}
        </div>
      )}
      <button className="primary-button login-button" disabled={busy}>
        {busy ? (
          <span className="spinner" />
        ) : (
          <>
            Tiếp tục <Icon name="arrow" size={16} />
          </>
        )}
      </button>
      {!compact && (
        <p className="demo-hint">
          Môi trường phát triển: admin@aicount.example.com / ChangeMe123!
        </p>
      )}
    </form>
  );

  if (!ready)
    return (
      <div className="boot">
        <Icon name="logo" size={30} />
      </div>
    );
  if (!account)
    return (
      <main className="login-page">
        <section className="login-story">
          <div className="login-brand">
            <span className="brand-mark">
              <Icon name="logo" size={19} />
            </span>
            <span>AICount Guard</span>
          </div>
          <div className="story-copy">
            <div className="eyebrow">EVIDENCE-FIRST REVIEW</div>
            <h2>
              Kiểm soát hóa đơn,
              <br />
              không đánh mất ngữ cảnh.
            </h2>
            <p>
              Mọi cảnh báo đều đi cùng bằng chứng. AI hỗ trợ phân tích, con
              người giữ quyền quyết định.
            </p>
          </div>
          <div className="story-window">
            <div className="window-bar">
              <i />
              <i />
              <i />
              <span>invoice-review</span>
            </div>
            <div className="window-body">
              <span className="code-line w80" />
              <span className="code-line w55" />
              <span className="code-line accent w70" />
              <span className="code-line w40" />
              <div className="window-result">
                <Icon name="spark" size={16} />
                <span>3 tín hiệu cần con người xem xét</span>
              </div>
            </div>
          </div>
          <div className="story-footer">
            <span>
              <i className="pulse" /> Hệ thống sẵn sàng
            </span>
            <span>Human-in-the-loop</span>
          </div>
        </section>
        <section className="login-side">
          <button
            className="theme-button login-theme"
            onClick={toggleTheme}
            aria-label="Đổi giao diện"
          >
            <Icon
              name={
                theme === "dark"
                  ? "moon"
                  : theme === "light"
                    ? "sun"
                    : "monitor"
              }
            />
          </button>
          {loginCard()}
        </section>
      </main>
    );

  const nav = [
    {
      id: "overview",
      label: "Tổng quan",
      icon: "chart",
      count: undefined,
    },
    {
      id: "invoices",
      label: "Hóa đơn",
      icon: "inbox",
      count: stats.review || undefined,
    },
    {
      id: "reviews",
      label: "Hàng chờ duyệt",
      icon: "review",
      count: undefined,
    },
    {
      id: "files",
      label: "Kho tệp cá nhân",
      icon: "folder",
      count: fileUsage.total || undefined,
    },
    { id: "legal", label: "Thư viện pháp lý", icon: "book", count: undefined },
    {
      id: "audit",
      label: "Nhật ký kiểm toán",
      icon: "shield",
      count: undefined,
    },
  ] as const;

  return (
    <main className="app-shell" data-dev-reload="webpack-polling">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="brand-mark">
            <Icon name="logo" size={18} />
          </span>
          <span>AICount</span>
          <span className="product-pill">GUARD</span>
        </div>
        <nav className="navigation">
          <div className="nav-label">WORKSPACE</div>
          {nav.map((item) => (
            <button
              key={item.id}
              className={view === item.id ? "nav-item active" : "nav-item"}
              onClick={() => {
                setView(item.id);
                setError("");
              }}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
              {item.count && <b>{item.count}</b>}
            </button>
          ))}
        </nav>
        <div className="sidebar-spacer" />
        <div className="system-card">
          <span>
            <i className="pulse" /> Human in the loop
          </span>
          <strong>Đang bảo vệ</strong>
          <small>AI không tự phê duyệt</small>
        </div>
        <button
          className={view === "settings" ? "nav-item active" : "nav-item"}
          onClick={() => setView("settings")}
        >
          <Icon name="settings" />
          <span>Cài đặt</span>
        </button>
      </aside>
      <section className="workspace">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>{account.user.tenant_name ?? "Workspace"}</span>
            <Icon name="chevron" size={14} />
            <strong>
              {view === "overview"
                ? "Tổng quan"
                : view === "invoices"
                  ? "Hóa đơn"
                  : view === "files"
                    ? "Kho tệp cá nhân"
                    : view === "reviews"
                      ? "Hàng chờ duyệt"
                      : view === "legal"
                        ? "Thư viện pháp lý"
                        : view === "audit"
                          ? "Nhật ký kiểm toán"
                          : "Cài đặt"}
            </strong>
          </div>
          <div className="top-actions">
            <button
              type="button"
              className="global-search"
              onClick={() => setCommandOpen(true)}
              aria-label="Mở Command Center"
            >
              <Icon name="search" size={16} />
              <span>Tìm kiếm hoặc chạy lệnh...</span>
              <kbd>Ctrl K</kbd>
            </button>
            <button
              className="theme-button"
              onClick={toggleTheme}
              aria-label="Đổi giao diện"
            >
              <Icon
                name={
                  theme === "dark"
                    ? "moon"
                    : theme === "light"
                      ? "sun"
                      : "monitor"
                }
              />
            </button>
            {view === "invoices" && (
              <>
                <input
                  ref={uploadRef}
                  className="hidden-input"
                  type="file"
                  accept=".xml,.pdf,.png,.jpg,.jpeg,.webp"
                  onChange={(e) => uploadFile(e.target.files?.[0])}
                />
                <button
                  className="primary-button"
                  onClick={() => uploadRef.current?.click()}
                  disabled={busy}
                >
                  <Icon name="upload" size={16} />
                  Tải hóa đơn
                </button>
              </>
            )}
            {view === "files" && (
              <>
                <input
                  ref={fileUploadRef}
                  className="hidden-input"
                  type="file"
                  accept=".xml,.pdf,.png,.jpg,.jpeg,.webp,.csv,.txt,.doc,.docx,.xls,.xlsx,.zip"
                  onChange={(e) => uploadStoredFile(e.target.files?.[0])}
                />
                <button
                  className="primary-button"
                  onClick={() => fileUploadRef.current?.click()}
                  disabled={busy}
                >
                  <Icon name="upload" size={16} />
                  Lưu tệp
                </button>
              </>
            )}
          </div>
        </header>
        {view === "overview" && (
          <div className="page-view overview-view">
            <div className="overview-heading">
              <div>
                <div className="eyebrow">TỔNG QUAN HÔM NAY</div>
                <h1>
                  Chào {account.user.full_name.split(" ").at(-1)}, hệ thống đang
                  được giám sát.
                </h1>
                <p>
                  Theo dõi trạng thái xử lý, mức rủi ro và các tài nguyên của
                  workspace trên một màn hình.
                </p>
              </div>
              <button
                type="button"
                className="primary-button"
                onClick={() => setView("invoices")}
              >
                Mở hàng đợi <Icon name="arrow" size={14} />
              </button>
            </div>

            <section className="overview-kpis" aria-label="Chỉ số tổng quan">
              <article>
                <span className="overview-kpi-icon">
                  <Icon name="inbox" size={17} />
                </span>
                <div>
                  <small>Tổng hóa đơn</small>
                  <strong>{stats.total}</strong>
                  <em>Trong workspace hiện tại</em>
                </div>
              </article>
              <article>
                <span className="overview-kpi-icon amber">
                  <Icon name="review" size={17} />
                </span>
                <div>
                  <small>Chờ duyệt</small>
                  <strong>{stats.review}</strong>
                  <em>{dashboard.reviewRate}% tổng hàng đợi</em>
                </div>
              </article>
              <article>
                <span className="overview-kpi-icon red">
                  <Icon name="shield" size={17} />
                </span>
                <div>
                  <small>Rủi ro cao</small>
                  <strong>{stats.risk}</strong>
                  <em>Điểm rủi ro từ 60 trở lên</em>
                </div>
              </article>
              <article>
                <span className="overview-kpi-icon green">
                  <Icon name="check" size={17} />
                </span>
                <div>
                  <small>Đã duyệt</small>
                  <strong>{stats.approved}</strong>
                  <em>{dashboard.completedRate}% đã hoàn tất</em>
                </div>
              </article>
            </section>

            <section className="overview-dashboard-grid">
              <article className="overview-chart-card status-chart-card">
                <header>
                  <div>
                    <span className="eyebrow">WORKFLOW</span>
                    <h2>Trạng thái xử lý</h2>
                  </div>
                  <span>{stats.total} hóa đơn</span>
                </header>
                <div className="status-chart-content">
                  <div
                    className="status-donut"
                    style={{
                      background: stats.total
                        ? `conic-gradient(var(--green) 0 ${dashboard.completedRate}%, var(--amber) ${dashboard.completedRate}% ${dashboard.completedRate + dashboard.reviewRate}%, var(--line-strong) ${dashboard.completedRate + dashboard.reviewRate}% 100%)`
                        : "conic-gradient(var(--line) 0 100%)",
                    }}
                    aria-label={`${dashboard.completedRate}% hóa đơn đã duyệt`}
                  >
                    <span>
                      <strong>{dashboard.completedRate}%</strong>
                      <small>hoàn tất</small>
                    </span>
                  </div>
                  <div className="overview-chart-legend">
                    <div>
                      <i className="green" />
                      <span>Đã duyệt</span>
                      <strong>{stats.approved}</strong>
                    </div>
                    <div>
                      <i className="amber" />
                      <span>Chờ duyệt</span>
                      <strong>{stats.review}</strong>
                    </div>
                    <div>
                      <i />
                      <span>Trạng thái khác</span>
                      <strong>{dashboard.other}</strong>
                    </div>
                  </div>
                </div>
              </article>

              <article className="overview-chart-card risk-chart-card">
                <header>
                  <div>
                    <span className="eyebrow">RISK ENGINE</span>
                    <h2>Phân bố rủi ro</h2>
                  </div>
                  <span>Trung bình {dashboard.averageRisk}/100</span>
                </header>
                <div className="risk-distribution">
                  {[
                    {
                      key: "low",
                      label: "Thấp",
                      range: "0–29",
                      value: dashboard.riskBands.low,
                    },
                    {
                      key: "medium",
                      label: "Trung bình",
                      range: "30–59",
                      value: dashboard.riskBands.medium,
                    },
                    {
                      key: "high",
                      label: "Cao",
                      range: "60–100",
                      value: dashboard.riskBands.high,
                    },
                  ].map((band) => (
                    <div className={`risk-band ${band.key}`} key={band.key}>
                      <div>
                        <strong>{band.label}</strong>
                        <span>{band.range}</span>
                        <em>{band.value}</em>
                      </div>
                      <span className="risk-band-track">
                        <i
                          style={{
                            width: `${dashboard.riskSamples ? Math.max(4, (band.value / dashboard.riskSamples) * 100) : 0}%`,
                          }}
                        />
                      </span>
                    </div>
                  ))}
                </div>
              </article>

              <article className="overview-chart-card activity-chart-card">
                <header>
                  <div>
                    <span className="eyebrow">7 NGÀY GẦN NHẤT</span>
                    <h2>Khối lượng hóa đơn tiếp nhận</h2>
                  </div>
                  <span>{stats.total} bản ghi đang theo dõi</span>
                </header>
                <div className="activity-bars">
                  {dashboard.activity.map((day) => (
                    <div key={day.key}>
                      <span className="activity-value">{day.count}</span>
                      <span className="activity-track">
                        <i
                          style={{
                            height: `${Math.max(4, (day.count / dashboard.maxActivity) * 100)}%`,
                          }}
                        />
                      </span>
                      <small>{day.label}</small>
                    </div>
                  ))}
                </div>
              </article>

              <article className="overview-chart-card system-chart-card">
                <header>
                  <div>
                    <span className="eyebrow">SYSTEM STATUS</span>
                    <h2>Tình trạng dịch vụ & dữ liệu</h2>
                  </div>
                  <span className="system-online">
                    <i className="pulse" /> Đang hoạt động
                  </span>
                </header>
                <div className="system-health-grid">
                  <div>
                    <Icon name="shield" size={16} />
                    <span>
                      <strong>Phiên API</strong>
                      <small>Xác thực tenant thành công</small>
                    </span>
                    <em>Ổn định</em>
                  </div>
                  <div>
                    <Icon name="book" size={16} />
                    <span>
                      <strong>Corpus pháp lý</strong>
                      <small>
                        {legalCorpus?.chunks_indexed ??
                          legalCorpus?.indexed_chunks ??
                          0}{" "}
                        đoạn đã lập chỉ mục
                      </small>
                    </span>
                    <em>
                      {legalCorpus?.documents_indexed ??
                        legalCorpus?.indexed_documents ??
                        0}
                      /{legalCorpus?.documents_in_manifest ?? 31}
                    </em>
                  </div>
                  <div>
                    <Icon name="folder" size={16} />
                    <span>
                      <strong>Kho tệp cá nhân</strong>
                      <small>{bytes(fileUsage.used)} đã sử dụng</small>
                    </span>
                    <em>{fileUsage.total} tệp</em>
                  </div>
                  <div>
                    <Icon name="review" size={16} />
                    <span>
                      <strong>Human-in-the-loop</strong>
                      <small>AI không tự phê duyệt quyết định</small>
                    </span>
                    <em>{stats.review} chờ xử lý</em>
                  </div>
                </div>
              </article>
            </section>
          </div>
        )}
        {view === "invoices" && (
          <div className="view-content invoices-view">
            <section className="workbench">
              <aside className="invoice-queue">
                <div className="queue-head">
                  <div>
                    <h2>Hộp thư hóa đơn</h2>
                    <span>{filtered.length} mục</span>
                  </div>
                  <button className="icon-button">
                    <Icon name="more" />
                  </button>
                </div>
                <div className="filters">
                  <button
                    className={filter === "all" ? "active" : ""}
                    onClick={() => setFilter("all")}
                  >
                    Tất cả
                  </button>
                  <button
                    className={filter === "NEEDS_REVIEW" ? "active" : ""}
                    onClick={() => setFilter("NEEDS_REVIEW")}
                  >
                    Cần duyệt
                  </button>
                  <button
                    className={filter === "risk" ? "active" : ""}
                    onClick={() => setFilter("risk")}
                  >
                    Có rủi ro
                  </button>
                </div>
                <div className="invoice-list">
                  {filtered.map((item) => (
                    <button
                      key={item.id}
                      className={
                        selected?.id === item.id
                          ? "invoice-card active"
                          : "invoice-card"
                      }
                      onClick={() => {
                        setSelected(item);
                        setLastResult(null);
                        setEvidence(null);
                        setInspectorTab("overview");
                        setError("");
                      }}
                    >
                      <span className="file-icon">
                        <Icon name="file" size={18} />
                      </span>
                      <span className="invoice-copy">
                        <span className="invoice-line">
                          <strong>
                            {item.invoice_number || "Chưa nhận dạng số"}
                          </strong>
                          <small>{date(item.created_at)}</small>
                        </span>
                        <span className="seller">
                          {item.normalized_data?.seller_name ||
                            item.seller_tax_code ||
                            "Chưa xác định người bán"}
                        </span>
                        <span className="invoice-meta">
                          <Status value={item.status} />
                          {item.risk_result?.score != null && (
                            <em
                              className={
                                Number(item.risk_result.score) >= 60
                                  ? "risk-high"
                                  : ""
                              }
                            >
                              Risk {Math.round(item.risk_result.score)}
                            </em>
                          )}
                        </span>
                      </span>
                    </button>
                  ))}
                  {!filtered.length && !busy && (
                    <div className="empty-list">
                      <Icon name="inbox" size={25} />
                      <strong>Chưa có hóa đơn</strong>
                      <span>Tải tệp XML, PDF hoặc ảnh để bắt đầu.</span>
                    </div>
                  )}
                </div>
              </aside>
              <section className="inspector">
                {selected ? (
                  <>
                    <footer
                      className="decision-footer decision-header"
                      aria-label="Quyết định kiểm duyệt hóa đơn"
                    >
                      <div className="decision-footer-context">
                        <span className="decision-footer-icon">
                          <Icon name="shield" size={17} />
                        </span>
                        <span className="decision-footer-copy">
                          <span>HUMAN REVIEW</span>
                          <strong>Quyết định cuối cùng thuộc về bạn</strong>
                          <small>
                            Mọi hành động đều được ghi vào nhật ký kiểm toán.
                          </small>
                        </span>
                      </div>
                      <div className="decision-footer-side">
                        <Status value={selected.status} />
                        <div className="decision-footer-actions">
                          <button
                            type="button"
                            className="secondary-button danger-button"
                            onClick={() => decide("REJECTED")}
                            disabled={busy}
                          >
                            Từ chối
                          </button>
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => decide("ESCALATED")}
                            disabled={busy}
                          >
                            Chuyển cấp
                          </button>
                          <button
                            type="button"
                            className="primary-button"
                            onClick={() => decide("ACCEPTED")}
                            disabled={busy}
                          >
                            <Icon name="check" size={16} />
                            Chấp nhận
                          </button>
                        </div>
                      </div>
                    </footer>
                    <div className="inspector-head">
                      <div className="document-title">
                        <span className="file-icon large">
                          <Icon name="file" size={20} />
                        </span>
                        <div>
                          <h2>
                            {selected.invoice_number || "Hóa đơn chưa có số"}
                          </h2>
                          <p>
                            {selected.normalized_data?.seller_name ||
                              "Chưa xác định người bán"}{" "}
                            · {selected.seller_tax_code || "Chưa có MST"}
                          </p>
                        </div>
                      </div>
                      <div className="head-status">
                        <Status value={selected.status} />
                        <button
                          className="icon-button"
                          title="Hiệu chỉnh dữ liệu"
                          onClick={() => {
                            setCorrection({
                              field_name: "invoice_number",
                              value:
                                selected.normalized_data?.invoice_number ?? "",
                              reason: "",
                            });
                            setCorrecting(true);
                          }}
                        >
                          <Icon name="edit" />
                        </button>
                      </div>
                    </div>
                    <div className="inspector-tabs">
                      <button
                        className={inspectorTab === "overview" ? "active" : ""}
                        onClick={() => setInspectorTab("overview")}
                      >
                        Tổng quan
                      </button>
                      <button
                        className={inspectorTab === "evidence" ? "active" : ""}
                        onClick={showEvidence}
                      >
                        Bằng chứng
                      </button>
                      <button
                        className={inspectorTab === "history" ? "active" : ""}
                        onClick={() => setInspectorTab("history")}
                      >
                        Lịch sử
                      </button>
                    </div>
                    <div className="inspector-scroll">
                      {inspectorTab === "overview" ? (
                        <>
                          <div className="metric-grid">
                            <div>
                              <span>Độ tin cậy</span>
                              <strong>
                                {selected.normalized_data
                                  ?.extraction_confidence != null
                                  ? `${Math.round(selected.normalized_data.extraction_confidence * 100)}%`
                                  : "—"}
                              </strong>
                              <i>
                                <b
                                  style={{
                                    width: `${Math.round((selected.normalized_data?.extraction_confidence ?? 0) * 100)}%`,
                                  }}
                                />
                              </i>
                            </div>
                            <div>
                              <span>Điểm rủi ro</span>
                              <strong
                                className={
                                  Number(selected.risk_result?.score ?? 0) >= 60
                                    ? "danger-text"
                                    : ""
                                }
                              >
                                {selected.risk_result?.score != null
                                  ? Math.round(selected.risk_result.score)
                                  : "—"}
                                <small>/100</small>
                              </strong>
                            </div>
                            <div>
                              <span>Tín hiệu</span>
                              <strong>{alerts.length}</strong>
                              <small>
                                {alerts.length
                                  ? "cần xem xét"
                                  : "chưa phát hiện"}
                              </small>
                            </div>
                          </div>
                          <div className="section-block">
                            <div className="section-title">
                              <h3>Thông tin chứng từ</h3>
                              <span>Nguồn: {selected.source_version}</span>
                            </div>
                            <div className="facts-grid">
                              <div>
                                <span>Số hóa đơn</span>
                                <strong>
                                  {selected.normalized_data?.invoice_number ||
                                    "—"}
                                </strong>
                              </div>
                              <div>
                                <span>Ngày lập</span>
                                <strong>
                                  {date(selected.normalized_data?.invoice_date)}
                                </strong>
                              </div>
                              <div>
                                <span>Người bán</span>
                                <strong>
                                  {selected.normalized_data?.seller_name || "—"}
                                </strong>
                              </div>
                              <div>
                                <span>Mã số thuế</span>
                                <strong>
                                  {selected.normalized_data?.seller_tax_code ||
                                    "—"}
                                </strong>
                              </div>
                              <div>
                                <span>Tiền trước thuế</span>
                                <strong>
                                  {money(
                                    selected.normalized_data?.subtotal,
                                    selected.normalized_data?.currency,
                                  )}
                                </strong>
                              </div>
                              <div className="total-fact">
                                <span>Tổng thanh toán</span>
                                <strong>
                                  {money(
                                    selected.normalized_data?.total_amount,
                                    selected.normalized_data?.currency,
                                  )}
                                </strong>
                              </div>
                            </div>
                          </div>
                          <div className="section-block analysis-section">
                            <div className="section-title">
                              <h3>Phân tích & kiểm soát</h3>
                              <span>AI chỉ đưa ra khuyến nghị</span>
                            </div>
                            <div className="analysis-actions">
                              <button
                                onClick={() => action("validate")}
                                disabled={busy}
                              >
                                <Icon name="check" />
                                <span>
                                  <strong>Kiểm tra quy tắc</strong>
                                  <small>Thuế, số học, trùng lặp</small>
                                </span>
                              </button>
                              <button
                                onClick={() => action("reconcile")}
                                disabled={busy}
                              >
                                <Icon name="review" />
                                <span>
                                  <strong>Đối chiếu</strong>
                                  <small>PO, nhập kho, thanh toán</small>
                                </span>
                              </button>
                              <button
                                onClick={() => action("score")}
                                disabled={busy}
                              >
                                <Icon name="spark" />
                                <span>
                                  <strong>Chấm rủi ro</strong>
                                  <small>Mô hình và dữ liệu</small>
                                </span>
                              </button>
                            </div>
                            {ruleDecision && (
                              <div className="rule-decision-card">
                                <Icon name="shield" size={19} />
                                <div>
                                  <span>Kết luận kiểm tra</span>
                                  <strong>{ruleDecision.label}</strong>
                                  <small>
                                    {ruleDecision.reason_code} · độ chắc chắn kỹ
                                    thuật {ruleDecision.confidence_score ?? 0}%
                                  </small>
                                </div>
                                <Status value={ruleDecision.status} />
                              </div>
                            )}
                          </div>
                          {!!alerts.length && (
                            <div className="section-block attention-section">
                              <div className="section-title">
                                <h3>Tín hiệu cần chú ý</h3>
                                <span>{alerts.length} cảnh báo</span>
                              </div>
                              <div className="alerts">
                                {alerts.map((alert: Json, index: number) => (
                                  <div
                                    className={`alert-row severity-${alert.severity}`}
                                    key={`${alert.code}-${index}`}
                                  >
                                    <span className="alert-dot" />
                                    <div>
                                      <strong>{alert.message}</strong>
                                      <span>
                                        {alert.code} ·{" "}
                                        {alert.rule_version || "rule engine"}
                                      </span>
                                    </div>
                                    <Status
                                      value={
                                        alert.severity === "critical" ||
                                        alert.severity === "high"
                                          ? "NEEDS_REVIEW"
                                          : "EXTRACTED"
                                      }
                                    />
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {lastResult && (
                            <details className="raw-result">
                              <summary>Kết quả có cấu trúc</summary>
                              <pre>{JSON.stringify(lastResult, null, 2)}</pre>
                            </details>
                          )}
                        </>
                      ) : inspectorTab === "evidence" ? (
                        <div className="evidence-view">
                          {evidence ? (
                            <>
                              <div className="evidence-ready">
                                <Icon name="shield" size={20} />
                                <span>
                                  <strong>Bộ bằng chứng đã sẵn sàng</strong>
                                  <small>
                                    {evidence.alerts?.length ?? 0} cảnh báo ·
                                    quyết định cuối cùng thuộc về con người
                                  </small>
                                </span>
                              </div>
                              <div className="evidence-cards">
                                <div>
                                  <span>Chứng từ gốc</span>
                                  <strong>
                                    {evidence.original_document?.filename ??
                                      "Tệp đã lưu"}
                                  </strong>
                                  <small>
                                    SHA-256:{" "}
                                    {evidence.original_document?.sha256?.slice(
                                      0,
                                      18,
                                    ) ?? "—"}
                                    …
                                  </small>
                                </div>
                                <div>
                                  <span>Phiên xử lý</span>
                                  <strong>
                                    {evidence.original_document
                                      ?.parser_version ?? "—"}
                                  </strong>
                                  <small>Bản gốc không bị thay đổi</small>
                                </div>
                                <div>
                                  <span>Điểm rủi ro</span>
                                  <strong>
                                    {evidence.risk?.score ?? "—"} / 100
                                  </strong>
                                  <small>
                                    {evidence.risk?.formula_version ??
                                      "Chưa chấm"}
                                  </small>
                                </div>
                              </div>
                              <div className="evidence-disclaimer">
                                <Icon name="shield" size={16} />
                                {evidence.legal_disclaimer}
                              </div>
                            </>
                          ) : (
                            <div className="table-empty">
                              {busy
                                ? "Đang tổng hợp bằng chứng…"
                                : "Chưa có bằng chứng."}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="history-view">
                          <div className="section-title">
                            <h3>Lịch sử trạng thái</h3>
                            <span>Thời gian gần nhất</span>
                          </div>
                          {[
                            {
                              label: "Cập nhật gần nhất",
                              value: selected.updated_at,
                              state: selected.status,
                            },
                            {
                              label: "Tải chứng từ",
                              value: selected.created_at,
                              state: "EXTRACTED",
                            },
                          ].map((entry) => (
                            <div className="history-item" key={entry.label}>
                              <span className="history-dot" />
                              <div>
                                <strong>{entry.label}</strong>
                                <small>{date(entry.value)}</small>
                              </div>
                              <Status value={entry.state} />
                            </div>
                          ))}
                          <p className="history-note">
                            Nhật ký kiểm toán chi tiết chỉ hiển thị cho vai trò
                            auditor hoặc system admin.
                          </p>
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="empty-inspector">
                    <span className="empty-orbit">
                      <Icon name="spark" size={25} />
                    </span>
                    <h2>Chọn một hóa đơn để kiểm tra</h2>
                    <p>
                      Các trường dữ liệu, tín hiệu rủi ro và bằng chứng sẽ xuất
                      hiện tại đây.
                    </p>
                    <button
                      className="secondary-button"
                      onClick={() => uploadRef.current?.click()}
                    >
                      <Icon name="upload" size={16} />
                      Tải hóa đơn đầu tiên
                    </button>
                  </div>
                )}
              </section>
            </section>
          </div>
        )}
        {view === "files" && (
          <div className="page-view files-view">
            <div className="page-heading files-heading">
              <div>
                <div className="eyebrow">PERSONAL CLOUD</div>
                <h1>Kho tệp của {account.user.full_name.split(" ").at(-1)}</h1>
                <p>
                  Tệp tại đây thuộc riêng tài khoản này và đồng bộ với ứng dụng
                  mobile.
                </p>
              </div>
              <div className="storage-summary">
                <div>
                  <strong>{bytes(fileUsage.used)}</strong>
                  <span>đã dùng / {bytes(fileUsage.quota)}</span>
                </div>
                <i>
                  <b
                    style={{
                      width: `${Math.min(100, (fileUsage.used / fileUsage.quota) * 100)}%`,
                    }}
                  />
                </i>
              </div>
            </div>
            <div className="file-toolbar">
              <div className="file-categories">
                {[
                  { id: "all", label: "Tất cả" },
                  { id: "document", label: "Tài liệu" },
                  { id: "spreadsheet", label: "Bảng tính" },
                  { id: "image", label: "Hình ảnh" },
                  { id: "invoice", label: "XML hóa đơn" },
                  { id: "archive", label: "Nén" },
                ].map((category) => (
                  <button
                    key={category.id}
                    className={fileFilter === category.id ? "active" : ""}
                    onClick={() => setFileFilter(category.id)}
                  >
                    {category.label}
                  </button>
                ))}
              </div>
              <span>{fileUsage.total} tệp · dữ liệu riêng tư</span>
            </div>
            <div className="file-grid">
              {files
                .filter((file) =>
                  `${file.filename} ${file.description} ${(file.tags ?? []).join(" ")}`
                    .toLowerCase()
                    .includes(query.toLowerCase()),
                )
                .map((file) => (
                  <article className="stored-file" key={file.id}>
                    <div
                      className={`stored-file-icon file-type-${file.category}`}
                    >
                      <Icon
                        name={file.category === "image" ? "file" : "folder"}
                        size={22}
                      />
                    </div>
                    <div className="stored-file-main">
                      <h2 title={file.filename}>{file.filename}</h2>
                      <p>{file.description || "Chưa có mô tả"}</p>
                      {!!file.tags?.length && (
                        <div className="file-tags">
                          {file.tags.map((tag: string) => (
                            <span key={tag}>{tag}</span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="stored-file-meta">
                      <span>{bytes(file.size_bytes)}</span>
                      <span>{date(file.updated_at)}</span>
                    </div>
                    <div className="stored-file-actions">
                      <button
                        title="Tải xuống"
                        onClick={() => downloadStoredFile(file)}
                      >
                        <Icon name="download" size={15} />
                      </button>
                      <button
                        title="Sửa mô tả và nhãn"
                        onClick={() => editStoredFile(file)}
                      >
                        <Icon name="edit" size={15} />
                      </button>
                      <button
                        className="danger-text"
                        title="Xóa tệp"
                        onClick={() => deleteStoredFile(file)}
                      >
                        <Icon name="trash" size={15} />
                      </button>
                    </div>
                  </article>
                ))}
              {!files.length && !busy && (
                <button
                  className="file-empty"
                  onClick={() => fileUploadRef.current?.click()}
                >
                  <span>
                    <Icon name="upload" size={24} />
                  </span>
                  <strong>Lưu tệp đầu tiên</strong>
                  <small>
                    PDF, Word, Excel, XML, ảnh hoặc ZIP · tối đa 25 MB
                  </small>
                </button>
              )}
            </div>
          </div>
        )}
        {view === "reviews" && (
          <div className="page-view">
            <div className="page-heading">
              <div>
                <div className="eyebrow">HUMAN REVIEW</div>
                <h1>Hàng chờ duyệt</h1>
                <p>Các quyết định đang chờ người có thẩm quyền xác nhận.</p>
              </div>
              <span className="page-count">{reviews.length} phiếu</span>
            </div>
            <div className="table-card">
              <div className="table-row table-head">
                <span>Phiếu duyệt</span>
                <span>Hóa đơn</span>
                <span>Vai trò phụ trách</span>
                <span>Ngày tạo</span>
                <span>Trạng thái</span>
              </div>
              {reviews.map((item) => (
                <button
                  className="table-row"
                  key={item.id}
                  onClick={() => {
                    const invoice = items.find((x) => x.id === item.invoice_id);
                    if (invoice) {
                      setSelected(invoice);
                      setView("invoices");
                    }
                  }}
                >
                  <span className="mono">{item.id.slice(0, 8)}</span>
                  <span className="mono">{item.invoice_id.slice(0, 8)}</span>
                  <span>{item.assigned_role.replaceAll("_", " ")}</span>
                  <span>{date(item.created_at)}</span>
                  <span>
                    <Status value={item.status} />
                  </span>
                </button>
              ))}
              {!reviews.length && !busy && (
                <div className="table-empty">
                  Không có phiếu duyệt nào trong workspace này.
                </div>
              )}
            </div>
          </div>
        )}
        {view === "legal" && (
          <div className="page-view legal-view">
            <header className="legal-toolbar">
              <form className="legal-search-box" onSubmit={searchLegal}>
                <Icon name="search" size={16} />
                <input
                  value={legalQuery}
                  onChange={(event) => setLegalQuery(event.target.value)}
                  placeholder="Tìm trong nội dung văn bản pháp lý…"
                  aria-label="Tìm kiếm văn bản pháp lý"
                />
                <label>
                  <span>Hiệu lực</span>
                  <input
                    type="date"
                    value={legalEffectiveOn}
                    onChange={(event) =>
                      setLegalEffectiveOn(event.target.value)
                    }
                  />
                </label>
                <select
                  value={legalDomain}
                  onChange={(event) => setLegalDomain(event.target.value)}
                  aria-label="Lĩnh vực pháp lý"
                >
                  <option value="">Tất cả lĩnh vực</option>
                  <option value="ai_governance">Quản trị AI</option>
                  <option value="data_governance">Quản trị dữ liệu</option>
                  <option value="digital_technology">Công nghệ số</option>
                  <option value="cybersecurity">An ninh mạng</option>
                  <option value="accounting">Kế toán</option>
                  <option value="accounting_tax_amendments">
                    Sửa đổi kế toán / thuế
                  </option>
                  <option value="invoice">Hóa đơn</option>
                  <option value="electronic_transactions">
                    Giao dịch điện tử
                  </option>
                  <option value="personal_data">Dữ liệu cá nhân</option>
                  <option value="tax_administration">Quản lý thuế</option>
                  <option value="corporate_income_tax">Thuế TNDN</option>
                  <option value="vat">Thuế GTGT</option>
                  <option value="sanctions">Chế tài</option>
                </select>
                <label className="legal-grounded-toggle">
                  <input
                    type="checkbox"
                    checked={legalGroundedOnly}
                    onChange={(event) =>
                      setLegalGroundedOnly(event.target.checked)
                    }
                  />
                  <span>Có bằng chứng PDF</span>
                </label>
                <button className="primary-button" disabled={busy}>
                  Tìm kiếm <Icon name="arrow" size={14} />
                </button>
              </form>
            </header>
            <div className="legal-workbench">
              <aside className="legal-explorer" aria-label="Danh mục văn bản">
                <div className="legal-explorer-title">
                  <span>EXPLORER · VĂN BẢN PHÁP LÝ</span>
                  <strong>{legalDocuments.length}</strong>
                </div>
                <label className="legal-document-filter">
                  <Icon name="search" size={14} />
                  <input
                    value={legalDocumentFilter}
                    onChange={(event) =>
                      setLegalDocumentFilter(event.target.value)
                    }
                    placeholder="Lọc theo số hiệu, tên, lĩnh vực"
                  />
                </label>
                <div className="legal-document-list">
                  {filteredLegalDocuments.map((document) => (
                    <button
                      type="button"
                      key={document.id}
                      className={`legal-document-item ${selectedLegalDocument?.id === document.id ? "active" : ""}`}
                      onClick={() => {
                        setSelectedLegalDocument(document);
                        setLegalPreviewPage(null);
                        setLegalPanel("preview");
                      }}
                    >
                      <Icon name="file" size={15} />
                      <span>
                        <strong>{document.number}</strong>
                        <small>{document.title}</small>
                        <em>
                          {legalDomainLabel(document.domain)} ·{" "}
                          {document.indexed_chunks} đoạn
                        </em>
                      </span>
                    </button>
                  ))}
                  {!filteredLegalDocuments.length && !busy && (
                    <div className="legal-document-empty">
                      Không có văn bản phù hợp bộ lọc.
                    </div>
                  )}
                </div>
              </aside>
              <section className="legal-editor">
                <div className="legal-editor-tabs" role="tablist">
                  <button
                    type="button"
                    className={legalPanel === "preview" ? "active" : ""}
                    onClick={() => setLegalPanel("preview")}
                    role="tab"
                    aria-selected={legalPanel === "preview"}
                  >
                    <Icon name="file" size={14} />
                    {selectedLegalDocument?.number ?? "Preview PDF"}
                  </button>
                  <button
                    type="button"
                    className={legalPanel === "search" ? "active" : ""}
                    onClick={() => setLegalPanel("search")}
                    role="tab"
                    aria-selected={legalPanel === "search"}
                  >
                    <Icon name="search" size={14} />
                    Kết quả tra cứu
                    {!!legalResults.length && (
                      <span>{legalResults.length}</span>
                    )}
                  </button>
                </div>
                {legalPanel === "preview" ? (
                  <div className="legal-preview-panel">
                    {selectedLegalDocument ? (
                      <>
                        <header className="legal-preview-header">
                          <div>
                            <span className="eyebrow">
                              PDF VERIFIED · SHA-256
                            </span>
                            <h1>{selectedLegalDocument.number}</h1>
                            <p>{selectedLegalDocument.title}</p>
                          </div>
                          <dl>
                            <div>
                              <dt>Lĩnh vực</dt>
                              <dd>
                                {legalDomainLabel(selectedLegalDocument.domain)}
                              </dd>
                            </div>
                            <div>
                              <dt>Hiệu lực</dt>
                              <dd>
                                {date(selectedLegalDocument.effective_from)}
                              </dd>
                            </div>
                            <div>
                              <dt>Đã lập chỉ mục</dt>
                              <dd>
                                {selectedLegalDocument.indexed_chunks} đoạn
                              </dd>
                            </div>
                          </dl>
                          <a
                            href={selectedLegalDocument.source_url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Nguồn chính thức <Icon name="arrow" size={13} />
                          </a>
                        </header>
                        <div className="legal-pdf-stage">
                          {legalPdfLoading && (
                            <div className="legal-pdf-state">
                              <span className="spinner" /> Đang xác minh và tải
                              PDF…
                            </div>
                          )}
                          {legalPdfError && !legalPdfLoading && (
                            <div className="legal-pdf-state error">
                              <Icon name="shield" />
                              <strong>Không thể mở bản preview</strong>
                              <span>{legalPdfError}</span>
                            </div>
                          )}
                          {legalPdfUrl && !legalPdfLoading && (
                            <iframe
                              className="legal-pdf-frame"
                              src={`${legalPdfUrl}${legalPreviewPage ? `#page=${legalPreviewPage}&view=FitH` : "#view=FitH"}`}
                              title={`PDF ${selectedLegalDocument.number}`}
                            />
                          )}
                        </div>
                      </>
                    ) : (
                      <div className="legal-editor-empty">
                        <Icon name="book" size={28} />
                        <strong>Chọn một văn bản trong Explorer</strong>
                        <span>
                          PDF sẽ được xác minh checksum trước khi hiển thị.
                        </span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="legal-search-panel">
                    {legalAssessment && (
                      <div
                        className={`legal-assessment ${String(legalAssessment.status ?? "").toLowerCase()}`}
                        role="status"
                      >
                        <Icon
                          name={
                            legalAssessment.status === "EVIDENCE_FOUND"
                              ? "check"
                              : "shield"
                          }
                          size={17}
                        />
                        <div>
                          <strong>{legalAssessment.label}</strong>
                          <p>{legalAssessment.message}</p>
                        </div>
                        <span>
                          {legalAssessment.effective_sources ?? 0} nguồn đang
                          hiệu lực
                        </span>
                      </div>
                    )}
                    <div className="results-caption">
                      <strong>Kết quả phù hợp</strong>
                      <span>{legalResults.length} kết quả</span>
                    </div>
                    <section className="legal-results">
                      {legalResults.map((result) => (
                        <article
                          className="legal-result"
                          key={`${result.document_id}:${result.chunk_id ?? "metadata"}`}
                        >
                          <span className="legal-icon">
                            <Icon name="book" />
                          </span>
                          <div>
                            <div className="legal-meta">
                              <Status value={result.evidence_status} />
                              <span>{result.number}</span>
                              <span>
                                {result.decision_eligible
                                  ? "Đủ điều kiện làm căn cứ rule"
                                  : "Chờ duyệt pháp lý"}
                              </span>
                            </div>
                            <h2>{result.title}</h2>
                            <p>
                              Ban hành {date(result.issued_date)} · Hiệu lực từ{" "}
                              {date(result.effective_from)}
                            </p>
                            {result.locator && (
                              <div className="legal-locator">
                                <Icon name="check" size={13} /> {result.locator}
                                {result.ocr_confidence != null && (
                                  <span>
                                    OCR{" "}
                                    {Math.round(result.ocr_confidence * 100)}%
                                  </span>
                                )}
                              </div>
                            )}
                            {result.snippet ? (
                              <blockquote>{result.snippet}</blockquote>
                            ) : (
                              <div className="legal-no-evidence">
                                Chưa dùng làm bằng chứng: PDF cần OCR hoặc lập
                                lại chỉ mục.
                              </div>
                            )}
                            <footer>
                              <code title={result.sha256}>
                                SHA {String(result.sha256 ?? "").slice(0, 12)}…
                              </code>
                              <span className="legal-links">
                                <button
                                  type="button"
                                  onClick={() => {
                                    const document = legalDocuments.find(
                                      (item) => item.id === result.document_id,
                                    );
                                    if (!document) return;
                                    setSelectedLegalDocument(document);
                                    setLegalPreviewPage(
                                      Number(
                                        result.page_start ?? result.page_end,
                                      ) || null,
                                    );
                                    setLegalPanel("preview");
                                  }}
                                >
                                  Preview
                                  {result.page_start
                                    ? ` trang ${result.page_start}`
                                    : " PDF"}
                                </button>
                                <a
                                  href={result.source_url}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  Nguồn chính thức{" "}
                                  <Icon name="arrow" size={13} />
                                </a>
                              </span>
                            </footer>
                          </div>
                        </article>
                      ))}
                      {!legalResults.length && !busy && (
                        <div className="table-empty legal-empty">
                          Nhập từ khóa trên thanh công cụ để tra cứu trong 31
                          văn bản.
                        </div>
                      )}
                    </section>
                  </div>
                )}
              </section>
            </div>
            <footer className="legal-statusbar">
              <span>
                <Icon name="shield" size={12} /> PDF nội bộ được đối chiếu
                checksum
              </span>
              <span>
                {legalCorpus?.documents_indexed ??
                  legalCorpus?.indexed_documents ??
                  0}
                /{legalCorpus?.documents_in_manifest ?? legalDocuments.length}{" "}
                văn bản ·{" "}
                {legalCorpus?.chunks_indexed ??
                  legalCorpus?.indexed_chunks ??
                  0}{" "}
                đoạn
              </span>
              <span>
                Kết quả hỗ trợ kiểm tra, không thay thế ý kiến pháp lý chuyên
                môn.
              </span>
            </footer>
          </div>
        )}
        {view === "audit" && (
          <div className="page-view">
            <div className="page-heading">
              <div>
                <div className="eyebrow">IMMUTABLE TRAIL</div>
                <h1>Nhật ký kiểm toán</h1>
                <p>
                  Mọi hành động quan trọng được lưu theo chuỗi băm của từng
                  workspace.
                </p>
              </div>
              <span className="page-count">
                <i className="pulse" />{" "}
                {auditVerify?.valid === false
                  ? "Phát hiện bất thường"
                  : `Chuỗi toàn vẹn · ${auditVerify?.event_count ?? audit.length} sự kiện`}
              </span>
            </div>
            <div className="table-card audit-table">
              <div className="table-row table-head">
                <span>#</span>
                <span>Hành động</span>
                <span>Tài nguyên</span>
                <span>Thời gian</span>
                <span>Correlation ID</span>
              </div>
              {audit.map((item) => (
                <div className="table-row" key={item.id}>
                  <span>{item.sequence}</span>
                  <span>
                    <strong>{item.action}</strong>
                  </span>
                  <span>
                    {item.resource_type} ·{" "}
                    <span className="mono">{item.resource_id.slice(0, 8)}</span>
                  </span>
                  <span>{date(item.created_at)}</span>
                  <span className="mono">
                    {item.correlation_id.slice(0, 8)}
                  </span>
                </div>
              ))}
              {!audit.length && !busy && (
                <div className="table-empty">
                  Chưa có sự kiện hoặc tài khoản không có quyền auditor.
                </div>
              )}
            </div>
          </div>
        )}
        {view === "settings" && (
          <div className="page-view settings-view">
            <div className="page-heading">
              <div>
                <div className="eyebrow">ACCOUNT & WORKSPACE</div>
                <h1>Cài đặt tài khoản & workspace</h1>
                <p>
                  Quản lý danh tính, phiên đăng nhập, giao diện và phạm vi dữ
                  liệu của workspace hiện tại.
                </p>
              </div>
              <button
                className="primary-button"
                onClick={() => {
                  setAddAccount(true);
                  setError("");
                }}
              >
                <Icon name="plus" size={16} />
                Thêm tài khoản
              </button>
            </div>
            <div className="settings-grid">
              <section className="settings-card identity-settings-card">
                <div className="identity-settings-heading">
                  <span className="avatar settings-profile-avatar">
                    {initials(account.user.full_name)}
                  </span>
                  <div>
                    <span className="eyebrow">TÀI KHOẢN ĐANG HOẠT ĐỘNG</span>
                    <h2>{account.user.full_name}</h2>
                    <p>{account.user.email}</p>
                  </div>
                  <span className="session-health">
                    <i className="pulse" /> Phiên hợp lệ
                  </span>
                </div>
                <dl className="settings-detail-grid">
                  <div>
                    <dt>Workspace</dt>
                    <dd>{account.user.tenant_name ?? "Workspace"}</dd>
                  </div>
                  <div>
                    <dt>Tenant ID</dt>
                    <dd className="mono" title={account.user.tenant_id}>
                      {account.user.tenant_id}
                    </dd>
                  </div>
                  <div>
                    <dt>User ID</dt>
                    <dd className="mono" title={account.user.id}>
                      {account.user.id}
                    </dd>
                  </div>
                  <div>
                    <dt>Phiên hết hạn</dt>
                    <dd>
                      {dateTime(sessionExpiresAt)}
                      {sessionRemainingMinutes != null && (
                        <small>Còn khoảng {sessionRemainingMinutes} phút</small>
                      )}
                    </dd>
                  </div>
                  <div className="settings-roles-detail">
                    <dt>Vai trò & quyền truy cập</dt>
                    <dd>
                      {account.user.roles.map((role) => (
                        <span key={role}>{role.replaceAll("_", " ")}</span>
                      ))}
                    </dd>
                  </div>
                  <div>
                    <dt>Phiên trên thiết bị</dt>
                    <dd>
                      {accounts.length} tài khoản
                      <small>Lưu riêng trong session của trình duyệt</small>
                    </dd>
                  </div>
                </dl>
                <div className="settings-account-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      setAddAccount(true);
                      setError("");
                    }}
                  >
                    <Icon name="plus" size={15} /> Thêm tài khoản khác
                  </button>
                  <button
                    type="button"
                    className="secondary-button danger-text"
                    onClick={logoutCurrent}
                  >
                    <Icon name="logout" size={15} /> Đăng xuất tài khoản này
                  </button>
                </div>
              </section>
              <section className="settings-card theme-settings-card">
                <div className="settings-card-head">
                  <div>
                    <h2>Giao diện</h2>
                    <p>
                      Theo hệ thống hoặc chọn chế độ riêng cho thiết bị này.
                    </p>
                  </div>
                  <Icon name={theme === "system" ? "monitor" : theme} />
                </div>
                <div className="theme-options">
                  {(["system", "light", "dark"] as Theme[]).map((option) => (
                    <button
                      key={option}
                      className={theme === option ? "active" : ""}
                      onClick={() => applyTheme(option)}
                    >
                      <Icon
                        name={
                          option === "system"
                            ? "monitor"
                            : option === "light"
                              ? "sun"
                              : "moon"
                        }
                      />
                      <span>
                        <strong>
                          {option === "system"
                            ? "Hệ thống"
                            : option === "light"
                              ? "Sáng"
                              : "Tối"}
                        </strong>
                        <small>
                          {option === "system"
                            ? "Tự đổi theo thiết bị"
                            : option === "light"
                              ? "Nền sáng, tương phản nhẹ"
                              : "Dịu mắt trong môi trường tối"}
                        </small>
                      </span>
                      {theme === option && <Icon name="check" size={16} />}
                    </button>
                  ))}
                </div>
              </section>
              <section className="settings-card workspace-settings-card">
                <div className="settings-card-head">
                  <div>
                    <h2>Tổng quan workspace</h2>
                    <p>Dữ liệu đang thuộc tenant của tài khoản này.</p>
                  </div>
                  <Icon name="inbox" />
                </div>
                <div className="workspace-settings-metrics">
                  <div>
                    <span>Tổng hóa đơn</span>
                    <strong>{stats.total}</strong>
                  </div>
                  <div>
                    <span>Chờ duyệt</span>
                    <strong>{stats.review}</strong>
                  </div>
                  <div>
                    <span>Đã duyệt</span>
                    <strong>{stats.approved}</strong>
                  </div>
                  <div>
                    <span>Tệp cá nhân</span>
                    <strong>{fileUsage.total}</strong>
                  </div>
                  <div>
                    <span>Dung lượng</span>
                    <strong>{bytes(fileUsage.used)}</strong>
                    <small>Giới hạn {bytes(fileUsage.quota)}</small>
                  </div>
                  <div>
                    <span>Corpus pháp lý</span>
                    <strong>
                      {legalCorpus?.documents_indexed ??
                        legalCorpus?.indexed_documents ??
                        legalDocuments.length}
                    </strong>
                    <small>
                      {legalCorpus?.chunks_indexed ??
                        legalCorpus?.indexed_chunks ??
                        0}{" "}
                      đoạn đã lập chỉ mục
                    </small>
                  </div>
                </div>
              </section>
              <section className="settings-card">
                <div className="settings-card-head">
                  <div>
                    <h2>Tài khoản trên thiết bị</h2>
                    <p>
                      Chuyển tài khoản không trộn dữ liệu hay trạng thái đang
                      xem.
                    </p>
                  </div>
                  <span className="count-badge">{accounts.length}</span>
                </div>
                {accounts.map((item) => (
                  <div className="saved-account" key={item.user.id}>
                    <span className="avatar large-avatar">
                      {initials(item.user.full_name)}
                    </span>
                    <span>
                      <strong>{item.user.full_name}</strong>
                      <small>{item.user.email}</small>
                      <em>{item.user.tenant_name ?? item.user.tenant_id}</em>
                    </span>
                    {item.user.id === account.user.id ? (
                      <span className="current-badge">Đang dùng</span>
                    ) : (
                      <button
                        className="secondary-button"
                        onClick={() => switchAccount(item.user.id)}
                      >
                        Chuyển
                      </button>
                    )}
                  </div>
                ))}
              </section>
              <section className="settings-card boundary-card">
                <span className="boundary-icon">
                  <Icon name="shield" size={24} />
                </span>
                <h2>Ranh giới dữ liệu</h2>
                <p>
                  API xác thực tenant từ token. Hóa đơn, phiếu duyệt và nhật ký
                  đều được truy vấn bằng tenant ID, không lấy tenant từ dữ liệu
                  do trình duyệt gửi lên.
                </p>
                <ul>
                  <li>
                    <Icon name="check" size={15} /> Token riêng cho từng tài
                    khoản
                  </li>
                  <li>
                    <Icon name="check" size={15} /> Dữ liệu lọc tại backend
                  </li>
                  <li>
                    <Icon name="check" size={15} /> Nhật ký audit theo workspace
                  </li>
                  <li>
                    <Icon name="check" size={15} /> PDF pháp lý xác minh SHA-256
                    trước khi preview
                  </li>
                  <li>
                    <Icon name="check" size={15} /> Tự đăng xuất ngay khi token
                    hết hạn hoặc API trả 401
                  </li>
                </ul>
              </section>
            </div>
          </div>
        )}
      </section>
      {commandOpen && account && (
        <div
          className="command-backdrop"
          onMouseDown={() => setCommandOpen(false)}
        >
          <section
            className="command-palette"
            role="dialog"
            aria-modal="true"
            aria-label="Command Center"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <label className="command-input-row">
              <Icon name="search" size={17} />
              <input
                ref={commandInputRef}
                value={commandQuery}
                onChange={(event) => setCommandQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setCommandIndex((current) =>
                      Math.min(current + 1, commandItems.length - 1),
                    );
                  } else if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setCommandIndex((current) => Math.max(current - 1, 0));
                  } else if (event.key === "Enter") {
                    event.preventDefault();
                    executeCommand(commandItems[commandIndex]);
                  } else if (event.key === "Escape") {
                    setCommandOpen(false);
                  }
                }}
                placeholder="Tìm hóa đơn, văn bản hoặc gõ > để chạy lệnh"
                aria-label="Tìm kiếm hoặc chạy lệnh"
                aria-controls="command-results"
              />
              <kbd>Esc</kbd>
            </label>
            <div
              className="command-results"
              id="command-results"
              role="listbox"
            >
              {commandItems.map((item, index) => (
                <button
                  type="button"
                  key={item.id}
                  className={commandIndex === index ? "active" : ""}
                  onMouseEnter={() => setCommandIndex(index)}
                  onClick={() => executeCommand(item)}
                  role="option"
                  aria-selected={commandIndex === index}
                >
                  <Icon name={item.icon} size={16} />
                  <span>
                    <strong>{item.label}</strong>
                    <small>{item.detail}</small>
                  </span>
                  <em>{item.category}</em>
                </button>
              ))}
              {!commandItems.length && (
                <div className="command-empty">
                  Không tìm thấy hóa đơn, văn bản hoặc lệnh phù hợp.
                </div>
              )}
            </div>
            <footer className="command-footer">
              <span>
                <kbd>↑↓</kbd> di chuyển
              </span>
              <span>
                <kbd>Enter</kbd> mở
              </span>
              <span>
                <kbd>&gt;</kbd> chỉ hiển thị lệnh
              </span>
            </footer>
          </section>
        </div>
      )}
      {busy && <div className="progress-line" />}
      {error && account && (
        <div className="toast error-toast">
          <Icon name="close" size={16} />
          <span>{error}</span>
          <button onClick={() => setError("")}>
            <Icon name="close" size={14} />
          </button>
        </div>
      )}
      {toast && (
        <div className="toast success-toast">
          <Icon name="check" size={16} />
          {toast}
        </div>
      )}
      {correcting && selected && (
        <div
          className="modal-backdrop"
          onMouseDown={() => setCorrecting(false)}
        >
          <div
            className="account-modal correction-modal"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="correction-dialog-title"
          >
            <button
              className="modal-close"
              onClick={() => setCorrecting(false)}
              aria-label="Đóng cửa sổ hiệu chỉnh"
            >
              <Icon name="close" />
            </button>
            <form className="correction-form" onSubmit={submitCorrection}>
              <div className="form-heading">
                <div className="eyebrow">AUDITED CORRECTION</div>
                <h1 id="correction-dialog-title">Hiệu chỉnh dữ liệu</h1>
                <p>Thay đổi sẽ tạo phiếu duyệt và được ghi vào chuỗi audit.</p>
              </div>
              <label>
                Trường dữ liệu
                <select
                  autoFocus
                  value={correction.field_name}
                  onChange={(event) =>
                    setCorrection({
                      ...correction,
                      field_name: event.target.value,
                      value:
                        selected.normalized_data?.[event.target.value] ?? "",
                    })
                  }
                >
                  {[
                    "invoice_number",
                    "invoice_symbol",
                    "invoice_date",
                    "seller_name",
                    "seller_tax_code",
                    "buyer_name",
                    "buyer_tax_code",
                    "currency",
                    "subtotal",
                    "tax_amount",
                    "fees",
                    "discounts",
                    "total_amount",
                    "extraction_confidence",
                  ].map((field) => (
                    <option key={field} value={field}>
                      {field.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Giá trị mới
                <input
                  value={correction.value}
                  onChange={(event) =>
                    setCorrection({ ...correction, value: event.target.value })
                  }
                  required
                />
              </label>
              <label>
                Lý do thay đổi
                <textarea
                  value={correction.reason}
                  onChange={(event) =>
                    setCorrection({ ...correction, reason: event.target.value })
                  }
                  placeholder="Ví dụ: Đã đối chiếu lại với tệp XML gốc"
                  minLength={5}
                  required
                />
              </label>
              <button className="primary-button login-button" disabled={busy}>
                {busy ? <span className="spinner" /> : <Icon name="check" />}
                Lưu hiệu chỉnh
              </button>
            </form>
          </div>
        </div>
      )}
      {addAccount && (
        <div
          className="modal-backdrop"
          onMouseDown={() => setAddAccount(false)}
        >
          <div
            className="account-modal"
            onMouseDown={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Thêm tài khoản"
          >
            <button
              className="modal-close"
              onClick={() => setAddAccount(false)}
              aria-label="Đóng cửa sổ thêm tài khoản"
            >
              <Icon name="close" />
            </button>
            {loginCard(true)}
          </div>
        </div>
      )}
    </main>
  );
}
