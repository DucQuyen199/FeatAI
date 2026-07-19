import * as DocumentPicker from "expo-document-picker";
import * as SecureStore from "expo-secure-store";
import { StatusBar } from "expo-status-bar";
import { ReactNode, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const API =
  process.env.EXPO_PUBLIC_API_URL ??
  (Platform.OS === "android"
    ? "http://10.0.2.2:8000/api/v1"
    : "http://localhost:8000/api/v1");

type Json = Record<string, any>;
type Theme = "system" | "light" | "dark";
type Tab = "home" | "invoices" | "files" | "reviews" | "legal" | "settings";
type User = {
  id: string;
  email: string;
  full_name: string;
  roles: string[];
  tenant_id: string;
  tenant_name?: string;
};
type Invoice = {
  id: string;
  status: string;
  invoice_number?: string;
  seller_tax_code?: string;
  normalized_data: Json;
  document?: Json;
  validation_result?: Json;
  reconciliation_result?: Json;
  anomaly_result?: Json;
  risk_result?: Json;
  created_at: string;
  updated_at: string;
};
type Review = {
  id: string;
  invoice_id: string;
  status: string;
  assigned_role: string;
  created_at: string;
};
type StoredFile = {
  id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  category: string;
  description: string;
  tags: string[];
  created_at: string;
  updated_at: string;
};
type Colors = typeof light;

const light = {
  canvas: "#F5F5F2",
  surface: "#FFFFFF",
  surfaceSoft: "#EFEFEB",
  elevated: "#FFFFFF",
  text: "#191918",
  textSoft: "#66665F",
  textFaint: "#92928A",
  line: "#DFDFDA",
  lineStrong: "#C9C9C2",
  inverse: "#1D1D1B",
  inverseText: "#FAFAF7",
  accent: "#EA5B28",
  accentSoft: "#FFF0E8",
  blue: "#4C6FFF",
  blueSoft: "#EDF1FF",
  green: "#16845B",
  greenSoft: "#E8F7F0",
  amber: "#A96207",
  amberSoft: "#FFF4DC",
  red: "#C43C43",
  redSoft: "#FFEDED",
};

const dark: Colors = {
  canvas: "#121211",
  surface: "#1C1C1A",
  surfaceSoft: "#181817",
  elevated: "#222220",
  text: "#F1F1ED",
  textSoft: "#AAA9A2",
  textFaint: "#77766F",
  line: "#30302D",
  lineStrong: "#41413C",
  inverse: "#EFEFE9",
  inverseText: "#171716",
  accent: "#FF7A45",
  accentSoft: "#3A241B",
  blue: "#8296FF",
  blueSoft: "#242A44",
  green: "#65C99A",
  greenSoft: "#1A3428",
  amber: "#E9AC55",
  amberSoft: "#382D1C",
  red: "#FF8589",
  redSoft: "#3D2224",
};

async function call(path: string, token?: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData))
    headers.set("content-type", "application/json");
  const response = await fetch(`${API}${path}`, { ...init, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(data.message ?? data.detail ?? `HTTP ${response.status}`);
  return data;
}

const money = (value: unknown, currency = "VND") =>
  typeof value === "number"
    ? new Intl.NumberFormat("vi-VN", {
        style: "currency",
        currency,
        maximumFractionDigits: 0,
      }).format(value)
    : "—";
const fileSize = (value = 0) =>
  value < 1024
    ? `${value} B`
    : value < 1024 ** 2
      ? `${(value / 1024).toFixed(1)} KB`
      : `${(value / 1024 ** 2).toFixed(1)} MB`;

const shortDate = (value?: string) =>
  value
    ? new Intl.DateTimeFormat("vi-VN", {
        day: "2-digit",
        month: "2-digit",
        year: "2-digit",
      }).format(new Date(value))
    : "—";

const statusLabels: Record<string, string> = {
  EXTRACTED: "Đã trích xuất",
  NEEDS_REVIEW: "Cần duyệt",
  HUMAN_APPROVED: "Đã duyệt",
  VALIDATED: "Đã kiểm tra",
  REJECTED: "Từ chối",
  ESCALATED: "Chuyển cấp",
  PENDING: "Đang chờ",
  ACCEPTED: "Đã chấp nhận",
};

function Glyph({ children, color }: { children: ReactNode; color?: string }) {
  return (
    <Text style={{ color, fontSize: 18, fontWeight: "500" }}>{children}</Text>
  );
}

export default function App() {
  const systemScheme = useColorScheme();
  const insets = useSafeAreaInsets();
  const [theme, setTheme] = useState<Theme>("system");
  const scheme = theme === "system" ? (systemScheme ?? "light") : theme;
  const colors = scheme === "dark" ? dark : light;
  const s = useMemo(() => createStyles(colors), [colors]);
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState("admin@aicount.example.com");
  const [password, setPassword] = useState("ChangeMe123!");
  const [tab, setTab] = useState<Tab>("home");
  const [items, setItems] = useState<Invoice[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [files, setFiles] = useState<StoredFile[]>([]);
  const [fileUsage, setFileUsage] = useState({ used: 0, quota: 1 });
  const [auditEvents, setAuditEvents] = useState<Json[]>([]);
  const [auditValid, setAuditValid] = useState<boolean | null>(null);
  const [selected, setSelected] = useState<Invoice | null>(null);
  const [detail, setDetail] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [legalQuery, setLegalQuery] = useState("hóa đơn điện tử");
  const [legalResults, setLegalResults] = useState<Json[]>([]);
  const [evidence, setEvidence] = useState<Json | null>(null);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [decisionOpen, setDecisionOpen] = useState(false);
  const [decisionType, setDecisionType] = useState<
    "ACCEPTED" | "REJECTED" | "ESCALATED"
  >("ACCEPTED");
  const [comment, setComment] = useState(
    "Đã đối chiếu với chứng từ gốc và bằng chứng hệ thống.",
  );

  const canReview =
    user?.roles.some((role) =>
      ["accountant_lead", "auditor", "system_admin"].includes(role),
    ) ?? false;

  async function load(activeToken = token, quiet = false) {
    if (!activeToken) return;
    if (!quiet) setBusy(true);
    try {
      const [invoiceData, me, fileData] = await Promise.all([
        call("/invoices?limit=200", activeToken),
        call("/auth/me", activeToken),
        call("/files?limit=200", activeToken),
      ]);
      setItems(invoiceData.items ?? []);
      setUser(me);
      setFiles(fileData.items ?? []);
      setFileUsage({
        used: Number(fileData.used_bytes ?? 0),
        quota: Number(fileData.quota_bytes ?? 1),
      });
      setSelected((current) =>
        current
          ? (invoiceData.items.find(
              (item: Invoice) => item.id === current.id,
            ) ?? current)
          : (invoiceData.items[0] ?? null),
      );
      if (
        me.roles.some((role: string) =>
          ["accountant_lead", "auditor", "system_admin"].includes(role),
        )
      ) {
        const reviewData = await call("/reviews", activeToken);
        setReviews(reviewData.items ?? []);
      }
      if (
        me.roles.some((role: string) =>
          ["auditor", "system_admin"].includes(role),
        )
      ) {
        const [events, verification] = await Promise.all([
          call("/audit/events?limit=20", activeToken),
          call("/audit/verify", activeToken),
        ]);
        setAuditEvents(events.items ?? []);
        setAuditValid(Boolean(verification.valid));
      }
    } finally {
      if (!quiet) setBusy(false);
    }
  }

  useEffect(() => {
    Promise.all([
      SecureStore.getItemAsync("access_token"),
      SecureStore.getItemAsync("aicount_theme"),
    ]).then(([savedToken, savedTheme]) => {
      if (
        savedTheme === "light" ||
        savedTheme === "dark" ||
        savedTheme === "system"
      )
        setTheme(savedTheme);
      setToken(savedToken);
      setReady(true);
      if (savedToken)
        load(savedToken).catch((error) =>
          Alert.alert("Không thể tải dữ liệu", error.message),
        );
    });
    // Initial secure storage hydration runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function changeTheme(next: Theme) {
    setTheme(next);
    await SecureStore.setItemAsync("aicount_theme", next);
  }

  async function login() {
    setBusy(true);
    try {
      const data = await call("/auth/login", undefined, {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      await SecureStore.setItemAsync("access_token", data.access_token);
      setToken(data.access_token);
      setUser(data.user);
      await load(data.access_token, true);
    } catch (error) {
      Alert.alert("Không đăng nhập được", (error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await SecureStore.deleteItemAsync("access_token");
    setToken(null);
    setUser(null);
    setItems([]);
    setFiles([]);
    setAuditEvents([]);
    setAuditValid(null);
    setSelected(null);
    setTab("home");
  }

  async function refresh() {
    setRefreshing(true);
    try {
      await load(token, true);
    } catch (error) {
      Alert.alert("Không thể làm mới", (error as Error).message);
    } finally {
      setRefreshing(false);
    }
  }

  async function upload() {
    if (!token) return;
    const picked = await DocumentPicker.getDocumentAsync({
      type: ["application/xml", "text/xml", "application/pdf", "image/*"],
      copyToCacheDirectory: true,
    });
    if (picked.canceled) return;
    const file = picked.assets[0];
    if (!file) return;
    const form = new FormData();
    form.append("file", {
      uri: file.uri,
      name: file.name,
      type: file.mimeType ?? "application/octet-stream",
    } as any);
    setBusy(true);
    try {
      const invoice = await call("/invoices", token, {
        method: "POST",
        body: form,
      });
      await load(token, true);
      setSelected(invoice);
      setDetail(true);
      setTab("invoices");
    } catch (error) {
      Alert.alert("Tải lên thất bại", (error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function uploadStoredFile() {
    if (!token) return;
    const picked = await DocumentPicker.getDocumentAsync({
      type: [
        "application/xml",
        "text/xml",
        "application/pdf",
        "image/*",
        "text/plain",
        "text/csv",
        "application/zip",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ],
      copyToCacheDirectory: true,
    });
    if (picked.canceled) return;
    const file = picked.assets[0];
    if (!file) return;
    const form = new FormData();
    form.append("file", {
      uri: file.uri,
      name: file.name,
      type: file.mimeType ?? "application/octet-stream",
    } as any);
    setBusy(true);
    try {
      await call("/files", token, { method: "POST", body: form });
      await load(token, true);
      setTab("files");
      Alert.alert(
        "Đã đồng bộ",
        "Tệp đã được lưu vào kho cá nhân và có thể xem trên web.",
      );
    } catch (error) {
      Alert.alert("Không thể lưu tệp", (error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function deleteStoredFile(file: StoredFile) {
    if (!token) return;
    Alert.alert("Xóa tệp", `Xóa vĩnh viễn “${file.filename}”?`, [
      { text: "Hủy", style: "cancel" },
      {
        text: "Xóa",
        style: "destructive",
        onPress: async () => {
          setBusy(true);
          try {
            await call(`/files/${file.id}`, token, { method: "DELETE" });
            await load(token, true);
          } catch (error) {
            Alert.alert("Không thể xóa tệp", (error as Error).message);
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  }

  async function run(action: "validate" | "reconcile" | "score") {
    if (!token || !selected) return;
    setBusy(true);
    try {
      const body =
        action === "reconcile"
          ? { purchase_order: null, goods_receipt: null, payment: null }
          : {};
      const result = await call(`/invoices/${selected.id}/${action}`, token, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (result.review_id) setReviewId(result.review_id);
      await load(token, true);
      Alert.alert(
        "Đã hoàn tất",
        action === "validate"
          ? "Bộ quy tắc đã được áp dụng."
          : action === "score"
            ? "Điểm rủi ro đã được cập nhật."
            : "Đã kiểm tra chứng từ đối chiếu.",
      );
    } catch (error) {
      Alert.alert("Không thể xử lý", (error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function loadEvidence() {
    if (!token || !selected) return;
    setBusy(true);
    try {
      setEvidence(await call(`/invoices/${selected.id}/evidence`, token));
    } catch (error) {
      Alert.alert("Không thể tải bằng chứng", (error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function openDecision(id?: string, type: typeof decisionType = "ACCEPTED") {
    const pending =
      id ??
      reviewId ??
      reviews.find(
        (review) =>
          review.invoice_id === selected?.id && review.status === "PENDING",
      )?.id;
    if (!pending) {
      Alert.alert(
        "Chưa có phiếu duyệt",
        "Hãy chạy kiểm tra hoặc chấm rủi ro trước.",
      );
      return;
    }
    setReviewId(pending);
    setDecisionType(type);
    setDecisionOpen(true);
  }

  async function submitDecision() {
    if (!token || !reviewId) return;
    setBusy(true);
    try {
      await call(`/reviews/${reviewId}/decisions`, token, {
        method: "POST",
        body: JSON.stringify({ decision: decisionType, comment }),
      });
      setDecisionOpen(false);
      setReviewId(null);
      await load(token, true);
      Alert.alert("Đã ghi nhận", "Quyết định đã được lưu vào nhật ký audit.");
    } catch (error) {
      Alert.alert("Không thể quyết định", (error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function searchLegal() {
    if (!token || legalQuery.trim().length < 2) return;
    setBusy(true);
    try {
      const data = await call(
        `/legal/search?q=${encodeURIComponent(legalQuery.trim())}&effective_on=${new Date().toISOString().slice(0, 10)}&limit=20`,
        token,
      );
      setLegalResults(data.results ?? []);
    } catch (error) {
      Alert.alert("Không thể tra cứu", (error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return items.filter((item) =>
      [
        item.invoice_number,
        item.seller_tax_code,
        item.normalized_data?.seller_name,
      ].some((value) =>
        String(value ?? "")
          .toLowerCase()
          .includes(normalized),
      ),
    );
  }, [items, query]);

  if (!ready)
    return (
      <View style={[s.root, s.center]}>
        <Brand colors={colors} />
      </View>
    );

  if (!token)
    return (
      <KeyboardAvoidingView
        style={[
          s.root,
          { paddingTop: insets.top, paddingBottom: insets.bottom },
        ]}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <StatusBar style={scheme === "dark" ? "light" : "dark"} />
        <ScrollView
          contentContainerStyle={s.loginPage}
          keyboardShouldPersistTaps="handled"
        >
          <View style={s.loginTop}>
            <Brand colors={colors} />
            <ThemeCycle theme={theme} colors={colors} onChange={changeTheme} />
          </View>
          <View style={s.loginVisual}>
            <Text style={s.kicker}>EVIDENCE-FIRST REVIEW</Text>
            <Text style={s.loginHero}>Rõ ràng trong từng quyết định.</Text>
            <Text style={s.loginLead}>
              Kiểm tra hóa đơn và phê duyệt an toàn trong một workspace.
            </Text>
            <View style={s.miniWindow}>
              <View style={s.miniWindowBar}>
                <View style={s.dot} />
                <View style={s.dot} />
                <View style={s.dot} />
                <Text style={s.miniWindowTitle}>invoice-review</Text>
              </View>
              <View style={s.miniWindowBody}>
                <View style={[s.codeLine, { width: "74%" }]} />
                <View style={[s.codeLine, { width: "48%" }]} />
                <View style={s.miniResult}>
                  <Text style={{ color: colors.accent }}>✦</Text>
                  <Text style={s.miniResultText}>2 tín hiệu cần xem xét</Text>
                </View>
              </View>
            </View>
          </View>
          <View style={s.loginCard}>
            <Text style={s.formKicker}>Chào mừng trở lại</Text>
            <Text style={s.formTitle}>Đăng nhập AICount</Text>
            <Text style={s.formHint}>Tiếp tục tới workspace của bạn.</Text>
            <FieldLabel>Email công việc</FieldLabel>
            <TextInput
              style={s.input}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              placeholder="ban@congty.vn"
              placeholderTextColor={colors.textFaint}
            />
            <FieldLabel>Mật khẩu</FieldLabel>
            <TextInput
              style={s.input}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="current-password"
              placeholder="Tối thiểu 8 ký tự"
              placeholderTextColor={colors.textFaint}
            />
            <Pressable style={s.primaryButton} onPress={login} disabled={busy}>
              {busy ? (
                <ActivityIndicator color={colors.inverseText} />
              ) : (
                <>
                  <Text style={s.primaryButtonText}>Tiếp tục</Text>
                  <Glyph color={colors.inverseText}>→</Glyph>
                </>
              )}
            </Pressable>
            <Text style={s.demoHint}>
              Development: admin@aicount.example.com / ChangeMe123!
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );

  const stats: {
    total: number;
    review: number;
    risk: number;
    approved: number;
  } = {
    total: items.length,
    review: items.filter((item) => item.status === "NEEDS_REVIEW").length,
    risk: items.filter((item) => Number(item.risk_result?.score ?? 0) >= 60)
      .length,
    approved: items.filter((item) => item.status === "HUMAN_APPROVED").length,
  };

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <View style={s.appHeader}>
        <Brand colors={colors} compact />
        <View style={s.headerActions}>
          <Pressable
            style={s.iconButton}
            onPress={() =>
              changeTheme(
                theme === "system"
                  ? "light"
                  : theme === "light"
                    ? "dark"
                    : "system",
              )
            }
          >
            <Glyph color={colors.textSoft}>
              {theme === "system" ? "▣" : theme === "light" ? "☼" : "☾"}
            </Glyph>
          </Pressable>
          <Pressable
            style={s.uploadButton}
            onPress={tab === "files" ? uploadStoredFile : upload}
            disabled={busy}
          >
            <Glyph color={colors.inverseText}>↑</Glyph>
            <Text style={s.primaryButtonText}>
              {tab === "files" ? "Lưu tệp" : "Tải lên"}
            </Text>
          </Pressable>
        </View>
      </View>

      <View style={s.content}>
        {tab === "home" && (
          <HomeView
            s={s}
            colors={colors}
            user={user}
            stats={stats}
            items={items}
            refreshing={refreshing}
            onRefresh={refresh}
            onUpload={upload}
            onAll={() => setTab("invoices")}
            onSelect={(invoice) => {
              setSelected(invoice);
              setDetail(true);
              setTab("invoices");
            }}
          />
        )}

        {tab === "invoices" &&
          (detail && selected ? (
            <InvoiceDetail
              s={s}
              colors={colors}
              invoice={selected}
              evidence={evidence}
              canReview={canReview}
              busy={busy}
              onBack={() => {
                setDetail(false);
                setEvidence(null);
              }}
              onRun={run}
              onEvidence={loadEvidence}
              onDecision={openDecision}
            />
          ) : (
            <InvoicesView
              s={s}
              colors={colors}
              items={filtered}
              query={query}
              setQuery={setQuery}
              refreshing={refreshing}
              onRefresh={refresh}
              onUpload={upload}
              onSelect={(invoice) => {
                setSelected(invoice);
                setDetail(true);
                setEvidence(null);
              }}
            />
          ))}

        {tab === "reviews" && (
          <ReviewsView
            s={s}
            colors={colors}
            reviews={reviews}
            invoices={items}
            onOpen={(review) => openDecision(review.id)}
          />
        )}

        {tab === "files" && (
          <FilesView
            s={s}
            colors={colors}
            files={files}
            usage={fileUsage}
            refreshing={refreshing}
            onRefresh={refresh}
            onUpload={uploadStoredFile}
            onDelete={deleteStoredFile}
            accountEmail={user?.email ?? ""}
          />
        )}

        {tab === "legal" && (
          <LegalView
            s={s}
            colors={colors}
            query={legalQuery}
            setQuery={setLegalQuery}
            results={legalResults}
            busy={busy}
            onSearch={searchLegal}
          />
        )}

        {tab === "settings" && (
          <SettingsView
            s={s}
            colors={colors}
            theme={theme}
            user={user}
            auditEvents={auditEvents}
            auditValid={auditValid}
            onTheme={changeTheme}
            onLogout={logout}
          />
        )}
      </View>

      <BottomNav
        s={s}
        colors={colors}
        tab={tab}
        setTab={(next) => {
          setTab(next);
          if (next !== "invoices") setDetail(false);
        }}
        pending={reviews.filter((review) => review.status === "PENDING").length}
        canReview={canReview}
        bottom={insets.bottom}
      />

      {busy && (
        <View style={s.busyBar}>
          <ActivityIndicator size="small" color={colors.accent} />
        </View>
      )}

      <Modal
        visible={decisionOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setDecisionOpen(false)}
      >
        <KeyboardAvoidingView
          style={s.modalBackdrop}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setDecisionOpen(false)}
          />
          <View
            style={[
              s.modalCard,
              { paddingBottom: Math.max(insets.bottom, 18) },
            ]}
          >
            <View style={s.modalHandle} />
            <Text style={s.modalKicker}>HUMAN DECISION</Text>
            <Text style={s.modalTitle}>Xác nhận quyết định</Text>
            <Text style={s.modalLead}>
              Quyết định được lưu cùng danh tính, thời gian và nhận xét.
            </Text>
            <View style={s.decisionPicker}>
              {(["ACCEPTED", "REJECTED", "ESCALATED"] as const).map((type) => (
                <Pressable
                  key={type}
                  style={[
                    s.decisionOption,
                    decisionType === type && s.decisionOptionActive,
                  ]}
                  onPress={() => setDecisionType(type)}
                >
                  <Text
                    style={[
                      s.decisionOptionText,
                      decisionType === type && s.decisionOptionTextActive,
                    ]}
                  >
                    {type === "ACCEPTED"
                      ? "Chấp nhận"
                      : type === "REJECTED"
                        ? "Từ chối"
                        : "Chuyển cấp"}
                  </Text>
                </Pressable>
              ))}
            </View>
            <FieldLabel>Nhận xét</FieldLabel>
            <TextInput
              style={[s.input, s.commentInput]}
              value={comment}
              onChangeText={setComment}
              multiline
              textAlignVertical="top"
              placeholderTextColor={colors.textFaint}
            />
            <Pressable
              style={[
                s.primaryButton,
                decisionType === "REJECTED" && { backgroundColor: colors.red },
              ]}
              onPress={submitDecision}
              disabled={busy || comment.trim().length < 3}
            >
              <Text style={s.primaryButtonText}>Xác nhận quyết định</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function HomeView({
  s,
  colors,
  user,
  stats,
  items,
  refreshing,
  onRefresh,
  onUpload,
  onAll,
  onSelect,
}: {
  s: any;
  colors: Colors;
  user: User | null;
  stats: Record<string, number>;
  items: Invoice[];
  refreshing: boolean;
  onRefresh: () => void;
  onUpload: () => void;
  onAll: () => void;
  onSelect: (invoice: Invoice) => void;
}) {
  return (
    <ScrollView
      contentContainerStyle={s.page}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.accent}
        />
      }
    >
      <Text style={s.kicker}>TỔNG QUAN HÔM NAY</Text>
      <Text style={s.pageTitle}>Chào {user?.full_name.split(" ").at(-1)}.</Text>
      <Text style={s.pageLead}>
        Đây là tình hình kiểm soát trong workspace của bạn.
      </Text>
      <View style={s.heroCard}>
        <View style={s.heroCardCopy}>
          <Text style={s.heroCardKicker}>BẮT ĐẦU NHANH</Text>
          <Text style={s.heroCardTitle}>Kiểm tra hóa đơn mới</Text>
          <Text style={s.heroCardText}>XML, PDF hoặc ảnh · tối đa 20 MB</Text>
        </View>
        <Pressable style={s.heroUpload} onPress={onUpload}>
          <Glyph color={colors.inverseText}>↑</Glyph>
        </Pressable>
      </View>
      <View style={s.statsGrid}>
        <Metric
          s={s}
          colors={colors}
          label="Tổng hóa đơn"
          value={stats.total ?? 0}
          note="Trong workspace"
          icon="▤"
          tone="blue"
        />
        <Metric
          s={s}
          colors={colors}
          label="Chờ duyệt"
          value={stats.review ?? 0}
          note="Cần xử lý"
          icon="✓"
          tone="amber"
        />
        <Metric
          s={s}
          colors={colors}
          label="Rủi ro cao"
          value={stats.risk ?? 0}
          note="Điểm từ 60"
          icon="!"
          tone="red"
        />
        <Metric
          s={s}
          colors={colors}
          label="Đã duyệt"
          value={stats.approved ?? 0}
          note="Bởi con người"
          icon="◇"
          tone="green"
        />
      </View>
      <View style={s.sectionHeader}>
        <View>
          <Text style={s.sectionTitle}>Hóa đơn gần đây</Text>
          <Text style={s.sectionHint}>Cập nhật mới nhất</Text>
        </View>
        <Pressable onPress={onAll}>
          <Text style={s.linkText}>Xem tất cả →</Text>
        </Pressable>
      </View>
      <View style={s.surfaceList}>
        {items.slice(0, 5).map((invoice, index) => (
          <InvoiceRow
            key={invoice.id}
            invoice={invoice}
            s={s}
            colors={colors}
            onPress={() => onSelect(invoice)}
            last={index === Math.min(items.length, 5) - 1}
          />
        ))}
        {!items.length && (
          <Empty
            s={s}
            icon="▤"
            title="Chưa có hóa đơn"
            text="Tải hóa đơn đầu tiên để bắt đầu."
          />
        )}
      </View>
      <View style={s.governanceCard}>
        <Glyph color={colors.green}>◇</Glyph>
        <View style={{ flex: 1 }}>
          <Text style={s.governanceTitle}>Human in the loop</Text>
          <Text style={s.governanceText}>
            AI hỗ trợ phân tích. Con người luôn giữ quyền quyết định cuối cùng.
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}

function InvoicesView({
  s,
  colors,
  items,
  query,
  setQuery,
  refreshing,
  onRefresh,
  onUpload,
  onSelect,
}: {
  s: any;
  colors: Colors;
  items: Invoice[];
  query: string;
  setQuery: (value: string) => void;
  refreshing: boolean;
  onRefresh: () => void;
  onUpload: () => void;
  onSelect: (invoice: Invoice) => void;
}) {
  return (
    <View style={s.pageFill}>
      <View style={s.pageHeadingRow}>
        <View>
          <Text style={s.kicker}>WORKSPACE</Text>
          <Text style={s.pageTitle}>Hóa đơn</Text>
        </View>
        <Pressable style={s.smallPrimary} onPress={onUpload}>
          <Text style={s.smallPrimaryText}>＋ Thêm</Text>
        </Pressable>
      </View>
      <View style={s.searchBox}>
        <Glyph color={colors.textFaint}>⌕</Glyph>
        <TextInput
          style={s.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Số hóa đơn, MST, người bán..."
          placeholderTextColor={colors.textFaint}
        />
      </View>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={s.invoiceList}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.accent}
          />
        }
        renderItem={({ item }) => (
          <InvoiceCard
            invoice={item}
            s={s}
            colors={colors}
            onPress={() => onSelect(item)}
          />
        )}
        ListEmptyComponent={
          <Empty
            s={s}
            icon="⌕"
            title="Không tìm thấy hóa đơn"
            text="Thử từ khóa khác hoặc tải tệp mới."
          />
        }
      />
    </View>
  );
}

function InvoiceDetail({
  s,
  colors,
  invoice,
  evidence,
  canReview,
  busy,
  onBack,
  onRun,
  onEvidence,
  onDecision,
}: {
  s: any;
  colors: Colors;
  invoice: Invoice;
  evidence: Json | null;
  canReview: boolean;
  busy: boolean;
  onBack: () => void;
  onRun: (action: "validate" | "reconcile" | "score") => void;
  onEvidence: () => void;
  onDecision: () => void;
}) {
  const data = invoice.normalized_data ?? {};
  const alerts = [
    invoice.validation_result,
    invoice.reconciliation_result,
    invoice.anomaly_result,
  ]
    .filter(Boolean)
    .flatMap((result) => result?.alerts ?? []);
  return (
    <ScrollView contentContainerStyle={s.page}>
      <Pressable style={s.backButton} onPress={onBack}>
        <Glyph color={colors.textSoft}>←</Glyph>
        <Text style={s.backText}>Hóa đơn</Text>
      </Pressable>
      <View style={s.detailTitleRow}>
        <View style={{ flex: 1 }}>
          <Text style={s.detailTitle}>
            {invoice.invoice_number || "Chưa nhận dạng số"}
          </Text>
          <Text style={s.detailSubtitle}>
            {data.seller_name || invoice.seller_tax_code || "Chưa có người bán"}
          </Text>
        </View>
        <StatusPill status={invoice.status} s={s} colors={colors} />
      </View>
      <View style={s.detailMetrics}>
        <View style={s.detailMetric}>
          <Text style={s.metricLabel}>Độ tin cậy</Text>
          <Text style={s.detailMetricValue}>
            {Math.round(Number(data.extraction_confidence ?? 0) * 100)}%
          </Text>
        </View>
        <View style={s.detailMetric}>
          <Text style={s.metricLabel}>Điểm rủi ro</Text>
          <Text style={s.detailMetricValue}>
            {invoice.risk_result?.score ?? "—"}
            <Text style={s.metricSuffix}>/100</Text>
          </Text>
        </View>
        <View style={[s.detailMetric, { borderRightWidth: 0 }]}>
          <Text style={s.metricLabel}>Tín hiệu</Text>
          <Text style={s.detailMetricValue}>{alerts.length}</Text>
        </View>
      </View>
      <Section
        s={s}
        title="Thông tin chứng từ"
        hint={invoice.document?.filename}
      >
        <View style={s.factsGrid}>
          <Fact s={s} label="Số hóa đơn" value={data.invoice_number} />
          <Fact s={s} label="Ngày lập" value={shortDate(data.invoice_date)} />
          <Fact s={s} label="Người bán" value={data.seller_name} />
          <Fact s={s} label="Mã số thuế" value={data.seller_tax_code} />
          <Fact
            s={s}
            label="Tiền trước thuế"
            value={money(data.subtotal, data.currency)}
          />
          <Fact
            s={s}
            label="Tổng thanh toán"
            value={money(data.total_amount, data.currency)}
            accent
          />
        </View>
      </Section>
      <Text style={s.sectionTitleStandalone}>Phân tích & kiểm soát</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.actionRow}
      >
        <ActionCard
          s={s}
          icon="✓"
          title="Kiểm tra"
          text="Quy tắc nghiệp vụ"
          onPress={() => onRun("validate")}
        />
        <ActionCard
          s={s}
          icon="⇄"
          title="Đối chiếu"
          text="PO và thanh toán"
          onPress={() => onRun("reconcile")}
        />
        <ActionCard
          s={s}
          icon="✦"
          title="Rủi ro"
          text="Mô hình dữ liệu"
          onPress={() => onRun("score")}
        />
        <ActionCard
          s={s}
          icon="◇"
          title="Bằng chứng"
          text="Nguồn và phiên bản"
          onPress={onEvidence}
        />
      </ScrollView>
      {!!alerts.length && (
        <Section
          s={s}
          title="Tín hiệu cần chú ý"
          hint={`${alerts.length} cảnh báo`}
        >
          {alerts.map((alert, index) => (
            <View style={s.alertRow} key={`${alert.code}-${index}`}>
              <View
                style={[
                  s.alertDot,
                  {
                    backgroundColor:
                      alert.severity === "high" || alert.severity === "critical"
                        ? colors.red
                        : colors.amber,
                  },
                ]}
              />
              <View style={{ flex: 1 }}>
                <Text style={s.alertTitle}>{alert.message}</Text>
                <Text style={s.alertMeta}>
                  {alert.code} · {alert.rule_version}
                </Text>
              </View>
            </View>
          ))}
        </Section>
      )}
      {evidence && (
        <Section s={s} title="Bộ bằng chứng" hint="Evidence pack">
          <View style={s.evidenceReady}>
            <Glyph color={colors.green}>◇</Glyph>
            <View style={{ flex: 1 }}>
              <Text style={s.evidenceTitle}>Bản gốc đã được bảo toàn</Text>
              <Text style={s.evidenceText}>
                {evidence.original_document?.filename} · SHA-256{" "}
                {evidence.original_document?.sha256?.slice(0, 12)}…
              </Text>
            </View>
          </View>
          <Text style={s.disclaimer}>{evidence.legal_disclaimer}</Text>
        </Section>
      )}
      {canReview && (
        <Pressable style={s.reviewButton} onPress={onDecision} disabled={busy}>
          <Glyph color={colors.inverseText}>✓</Glyph>
          <Text style={s.primaryButtonText}>Mở phiếu phê duyệt</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

function FilesView({
  s,
  colors,
  files,
  usage,
  refreshing,
  onRefresh,
  onUpload,
  onDelete,
  accountEmail,
}: {
  s: any;
  colors: Colors;
  files: StoredFile[];
  usage: { used: number; quota: number };
  refreshing: boolean;
  onRefresh: () => void;
  onUpload: () => void;
  onDelete: (file: StoredFile) => void;
  accountEmail: string;
}) {
  return (
    <ScrollView
      contentContainerStyle={s.page}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.accent}
        />
      }
    >
      <Text style={s.kicker}>PERSONAL CLOUD</Text>
      <Text style={s.pageTitle}>Kho tệp cá nhân</Text>
      <Text style={s.pageLead}>
        Tệp được giới hạn theo tài khoản và đồng bộ tức thời với web.
      </Text>
      <View style={s.storageCard}>
        <View style={s.storageTop}>
          <View>
            <Text style={s.storageValue}>{fileSize(usage.used)}</Text>
            <Text style={s.storageCaption}>
              đã dùng / {fileSize(usage.quota)}
            </Text>
          </View>
          <View style={s.storageCloud}>
            <Glyph color={colors.accent}>□</Glyph>
          </View>
        </View>
        <View style={s.storageTrack}>
          <View
            style={[
              s.storageProgress,
              { width: `${Math.min(100, (usage.used / usage.quota) * 100)}%` },
            ]}
          />
        </View>
        <Text style={s.storageOwner}>Chỉ {accountEmail} có quyền truy cập</Text>
      </View>
      <Pressable style={s.fileUploadCard} onPress={onUpload}>
        <View style={s.fileUploadIcon}>
          <Glyph color={colors.inverseText}>↑</Glyph>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.fileUploadTitle}>Lưu tệp mới</Text>
          <Text style={s.fileUploadText}>
            PDF, Office, XML, ảnh hoặc ZIP · 25 MB
          </Text>
        </View>
        <Glyph color={colors.textFaint}>›</Glyph>
      </Pressable>
      <View style={s.sectionHeader}>
        <View>
          <Text style={s.sectionTitle}>Tất cả tệp</Text>
          <Text style={s.sectionHint}>{files.length} mục trong tài khoản</Text>
        </View>
      </View>
      <View style={s.fileList}>
        {files.map((file) => (
          <View style={s.storedFileCard} key={file.id}>
            <View style={s.storedFileIcon}>
              <Glyph color={colors.textSoft}>
                {file.category === "spreadsheet"
                  ? "▦"
                  : file.category === "image"
                    ? "◇"
                    : "□"}
              </Glyph>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.storedFileName} numberOfLines={1}>
                {file.filename}
              </Text>
              <Text style={s.storedFileMeta}>
                {fileSize(file.size_bytes)} · {shortDate(file.updated_at)}
              </Text>
              {!!file.tags.length && (
                <Text style={s.storedFileTags} numberOfLines={1}>
                  {file.tags.map((tag) => `#${tag}`).join("  ")}
                </Text>
              )}
            </View>
            <Pressable style={s.fileDelete} onPress={() => onDelete(file)}>
              <Text style={s.fileDeleteText}>Xóa</Text>
            </Pressable>
          </View>
        ))}
      </View>
      {!files.length && (
        <View style={s.empty}>
          <Text style={s.emptyIcon}>□</Text>
          <Text style={s.emptyTitle}>Kho tệp đang trống</Text>
          <Text style={s.emptyText}>
            Tệp lưu từ mobile sẽ xuất hiện ngay trên web.
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

function ReviewsView({
  s,
  colors,
  reviews,
  invoices,
  onOpen,
}: {
  s: any;
  colors: Colors;
  reviews: Review[];
  invoices: Invoice[];
  onOpen: (review: Review) => void;
}) {
  const pending = reviews.filter((review) => review.status === "PENDING");
  return (
    <ScrollView contentContainerStyle={s.page}>
      <Text style={s.kicker}>HUMAN REVIEW</Text>
      <Text style={s.pageTitle}>Hàng chờ duyệt</Text>
      <Text style={s.pageLead}>
        Mỗi quyết định cần nhận xét và được ghi vào audit.
      </Text>
      <View style={s.queueBanner}>
        <Text style={s.queueCount}>{pending.length}</Text>
        <View>
          <Text style={s.queueTitle}>phiếu đang chờ</Text>
          <Text style={s.queueText}>Xếp theo thời gian tạo</Text>
        </View>
      </View>
      <View style={s.surfaceList}>
        {pending.map((review, index) => {
          const invoice = invoices.find(
            (item) => item.id === review.invoice_id,
          );
          return (
            <Pressable
              key={review.id}
              style={[
                s.reviewRow,
                index === pending.length - 1 && { borderBottomWidth: 0 },
              ]}
              onPress={() => onOpen(review)}
            >
              <View style={s.reviewIcon}>
                <Glyph color={colors.amber}>✓</Glyph>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.invoiceTitle}>
                  {invoice?.invoice_number || "Hóa đơn"}
                </Text>
                <Text style={s.invoiceSeller}>
                  {invoice?.normalized_data?.seller_name ||
                    review.invoice_id.slice(0, 8)}
                </Text>
                <Text style={s.invoiceAmount}>
                  {money(
                    invoice?.normalized_data?.total_amount,
                    invoice?.normalized_data?.currency,
                  )}
                </Text>
              </View>
              <Glyph color={colors.textFaint}>›</Glyph>
            </Pressable>
          );
        })}
        {!pending.length && (
          <Empty
            s={s}
            icon="✓"
            title="Hàng đợi đã trống"
            text="Không có phiếu nào đang chờ quyết định."
          />
        )}
      </View>
    </ScrollView>
  );
}

function LegalView({
  s,
  colors,
  query,
  setQuery,
  results,
  busy,
  onSearch,
}: {
  s: any;
  colors: Colors;
  query: string;
  setQuery: (value: string) => void;
  results: Json[];
  busy: boolean;
  onSearch: () => void;
}) {
  return (
    <ScrollView
      contentContainerStyle={s.page}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={s.kicker}>LEGAL KNOWLEDGE</Text>
      <Text style={s.pageTitle}>Thư viện pháp lý</Text>
      <Text style={s.pageLead}>Tra cứu corpus theo thời điểm hiệu lực.</Text>
      <View style={s.searchBox}>
        <Glyph color={colors.textFaint}>⌕</Glyph>
        <TextInput
          style={s.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Hóa đơn điện tử, thuế GTGT..."
          placeholderTextColor={colors.textFaint}
          onSubmitEditing={onSearch}
        />
        <Pressable style={s.searchButton} onPress={onSearch}>
          {busy ? (
            <ActivityIndicator size="small" color={colors.inverseText} />
          ) : (
            <Text style={s.searchButtonText}>Tìm</Text>
          )}
        </Pressable>
      </View>
      <View style={s.legalNotice}>
        <Glyph color={colors.green}>◇</Glyph>
        <Text style={s.legalNoticeText}>
          Kết quả hỗ trợ kiểm tra, không thay thế ý kiến pháp lý.
        </Text>
      </View>
      {results.map((result) => (
        <View style={s.legalCard} key={result.document_id}>
          <View style={s.legalCardTop}>
            <View style={s.legalIcon}>
              <Glyph color={colors.textSoft}>§</Glyph>
            </View>
            <StatusPill
              status={
                result.effective_on_query_date
                  ? "HUMAN_APPROVED"
                  : "NEEDS_REVIEW"
              }
              s={s}
              colors={colors}
            />
          </View>
          <Text style={s.legalTitle}>{result.title}</Text>
          <Text style={s.legalMeta}>
            {result.number} · Hiệu lực {shortDate(result.effective_from)}
          </Text>
          <Text style={s.legalId}>{result.document_id}</Text>
        </View>
      ))}
      {!results.length && (
        <Empty
          s={s}
          icon="§"
          title="Bắt đầu tra cứu"
          text="Nhập ít nhất 2 ký tự để tìm văn bản."
        />
      )}
    </ScrollView>
  );
}

function SettingsView({
  s,
  colors,
  theme,
  user,
  auditEvents,
  auditValid,
  onTheme,
  onLogout,
}: {
  s: any;
  colors: Colors;
  theme: Theme;
  user: User | null;
  auditEvents: Json[];
  auditValid: boolean | null;
  onTheme: (theme: Theme) => void;
  onLogout: () => void;
}) {
  return (
    <ScrollView contentContainerStyle={s.page}>
      <Text style={s.kicker}>ACCOUNT & WORKSPACE</Text>
      <Text style={s.pageTitle}>Cài đặt</Text>
      <Text style={s.pageLead}>
        Giao diện và phiên làm việc trên thiết bị này.
      </Text>
      <Section s={s} title="Giao diện" hint="Theo thiết bị">
        <View style={s.themeList}>
          {(["system", "light", "dark"] as Theme[]).map((option) => (
            <Pressable
              key={option}
              style={[s.themeOption, theme === option && s.themeOptionActive]}
              onPress={() => onTheme(option)}
            >
              <Glyph color={theme === option ? colors.accent : colors.textSoft}>
                {option === "system" ? "▣" : option === "light" ? "☼" : "☾"}
              </Glyph>
              <View style={{ flex: 1 }}>
                <Text style={s.themeTitle}>
                  {option === "system"
                    ? "Hệ thống"
                    : option === "light"
                      ? "Sáng"
                      : "Tối"}
                </Text>
                <Text style={s.themeText}>
                  {option === "system"
                    ? "Tự đổi theo thiết bị"
                    : option === "light"
                      ? "Nền sáng trung tính"
                      : "Dịu mắt trong môi trường tối"}
                </Text>
              </View>
              {theme === option && <Glyph color={colors.green}>✓</Glyph>}
            </Pressable>
          ))}
        </View>
      </Section>
      <Section
        s={s}
        title="Tài khoản"
        hint={user?.roles[0]?.replaceAll("_", " ")}
      >
        <View style={s.profileRow}>
          <View style={s.profileAvatar}>
            <Text style={s.profileInitials}>
              {user?.full_name
                .split(" ")
                .slice(-2)
                .map((part) => part[0])
                .join("")}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.profileName}>{user?.full_name}</Text>
            <Text style={s.profileEmail}>{user?.email}</Text>
            <Text style={s.profileTenant}>
              {user?.tenant_name ?? `${user?.tenant_id.slice(0, 12)}…`}
            </Text>
          </View>
        </View>
      </Section>
      <View style={s.governanceCard}>
        <Glyph color={colors.green}>◇</Glyph>
        <View style={{ flex: 1 }}>
          <Text style={s.governanceTitle}>Ranh giới dữ liệu</Text>
          <Text style={s.governanceText}>
            Token và mọi truy vấn nghiệp vụ đều bị giới hạn theo tenant ở
            backend.
          </Text>
        </View>
      </View>
      {!!auditEvents.length && (
        <Section
          s={s}
          title="Nhật ký kiểm toán"
          hint={auditValid === false ? "Cần kiểm tra" : "Chuỗi toàn vẹn"}
        >
          <View style={s.auditMobileList}>
            {auditEvents.slice(0, 6).map((event) => (
              <View style={s.auditMobileRow} key={event.id}>
                <View
                  style={[
                    s.auditMobileDot,
                    {
                      backgroundColor:
                        auditValid === false ? colors.red : colors.green,
                    },
                  ]}
                />
                <View style={{ flex: 1 }}>
                  <Text style={s.auditMobileAction}>{event.action}</Text>
                  <Text style={s.auditMobileMeta}>
                    {event.resource_type} · #{event.sequence} ·{" "}
                    {shortDate(event.created_at)}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </Section>
      )}
      <Pressable style={s.logoutButton} onPress={onLogout}>
        <Text style={s.logoutText}>Đăng xuất khỏi thiết bị</Text>
      </Pressable>
    </ScrollView>
  );
}

function BottomNav({
  s,
  colors,
  tab,
  setTab,
  pending,
  canReview,
  bottom,
}: {
  s: any;
  colors: Colors;
  tab: Tab;
  setTab: (tab: Tab) => void;
  pending: number;
  canReview: boolean;
  bottom: number;
}) {
  const entries: { id: Tab; icon: string; label: string }[] = [
    { id: "home", icon: "⌂", label: "Tổng quan" },
    { id: "invoices", icon: "▤", label: "Hóa đơn" },
    { id: "files", icon: "□", label: "Kho tệp" },
    ...(canReview
      ? [{ id: "reviews" as Tab, icon: "✓", label: "Phê duyệt" }]
      : []),
    { id: "legal", icon: "§", label: "Pháp lý" },
    { id: "settings", icon: "···", label: "Thêm" },
  ];
  return (
    <View
      style={[
        s.bottomNav,
        {
          paddingBottom: Math.max(bottom, 7),
          height: 58 + Math.max(bottom, 7),
        },
      ]}
    >
      {entries.map((entry) => (
        <Pressable
          key={entry.id}
          style={s.navItem}
          onPress={() => setTab(entry.id)}
        >
          <View>
            <Text
              style={[s.navIcon, tab === entry.id && { color: colors.accent }]}
            >
              {entry.icon}
            </Text>
            {entry.id === "reviews" && pending > 0 && (
              <View style={s.navBadge}>
                <Text style={s.navBadgeText}>{pending}</Text>
              </View>
            )}
          </View>
          <Text style={[s.navLabel, tab === entry.id && s.navLabelActive]}>
            {entry.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function Brand({
  colors,
  compact = false,
}: {
  colors: Colors;
  compact?: boolean;
}) {
  return (
    <View style={sBrand.wrap}>
      <View style={[sBrand.mark, { backgroundColor: colors.inverse }]}>
        <View style={[sBrand.ring, { borderColor: colors.inverseText }]} />
        <View style={[sBrand.slash, { backgroundColor: colors.accent }]} />
      </View>
      {!compact && (
        <Text style={[sBrand.name, { color: colors.text }]}>AICount Guard</Text>
      )}
    </View>
  );
}

function ThemeCycle({
  theme,
  colors,
  onChange,
}: {
  theme: Theme;
  colors: Colors;
  onChange: (theme: Theme) => void;
}) {
  return (
    <Pressable
      style={[
        sTheme.button,
        { borderColor: colors.line, backgroundColor: colors.surface },
      ]}
      onPress={() =>
        onChange(
          theme === "system" ? "light" : theme === "light" ? "dark" : "system",
        )
      }
    >
      <Text style={{ color: colors.textSoft, fontSize: 17 }}>
        {theme === "system" ? "▣" : theme === "light" ? "☼" : "☾"}
      </Text>
    </Pressable>
  );
}

function Metric({
  s,
  colors,
  label,
  value,
  note,
  icon,
  tone,
}: {
  s: any;
  colors: Colors;
  label: string;
  value: number;
  note: string;
  icon: string;
  tone: "blue" | "amber" | "red" | "green";
}) {
  const toneColor = colors[tone];
  const toneSoft = colors[`${tone}Soft` as keyof Colors];
  return (
    <View style={s.metricCard}>
      <View style={[s.metricIcon, { backgroundColor: toneSoft }]}>
        <Text style={{ color: toneColor, fontWeight: "700" }}>{icon}</Text>
      </View>
      <Text style={s.metricLabel}>{label}</Text>
      <Text style={s.metricValue}>{value}</Text>
      <Text style={s.metricNote}>{note}</Text>
    </View>
  );
}

function InvoiceRow({
  invoice,
  s,
  colors,
  onPress,
  last = false,
}: {
  invoice: Invoice;
  s: any;
  colors: Colors;
  onPress: () => void;
  last?: boolean;
}) {
  return (
    <Pressable
      style={[s.invoiceRow, last && { borderBottomWidth: 0 }]}
      onPress={onPress}
    >
      <View style={s.fileIcon}>
        <Glyph color={colors.textSoft}>▤</Glyph>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.invoiceTitle}>
          {invoice.invoice_number || "Chưa nhận dạng"}
        </Text>
        <Text style={s.invoiceSeller} numberOfLines={1}>
          {invoice.normalized_data?.seller_name ||
            invoice.seller_tax_code ||
            "Chưa có người bán"}
        </Text>
        <Text style={s.invoiceAmount}>
          {money(
            invoice.normalized_data?.total_amount,
            invoice.normalized_data?.currency,
          )}
        </Text>
      </View>
      <View style={s.invoiceSide}>
        <StatusPill status={invoice.status} s={s} colors={colors} />
        <Text style={s.invoiceDate}>{shortDate(invoice.updated_at)}</Text>
      </View>
    </Pressable>
  );
}

function InvoiceCard({
  invoice,
  s,
  colors,
  onPress,
}: {
  invoice: Invoice;
  s: any;
  colors: Colors;
  onPress: () => void;
}) {
  return (
    <Pressable style={s.invoiceCard} onPress={onPress}>
      <View style={s.invoiceCardTop}>
        <View style={s.fileIcon}>
          <Glyph color={colors.textSoft}>▤</Glyph>
        </View>
        <StatusPill status={invoice.status} s={s} colors={colors} />
      </View>
      <Text style={s.invoiceCardTitle}>
        {invoice.invoice_number || "Chưa nhận dạng số"}
      </Text>
      <Text style={s.invoiceCardSeller} numberOfLines={1}>
        {invoice.normalized_data?.seller_name ||
          invoice.seller_tax_code ||
          "Chưa có người bán"}
      </Text>
      <View style={s.invoiceCardFooter}>
        <Text style={s.invoiceCardAmount}>
          {money(
            invoice.normalized_data?.total_amount,
            invoice.normalized_data?.currency,
          )}
        </Text>
        <Text style={s.invoiceDate}>{shortDate(invoice.updated_at)} ›</Text>
      </View>
    </Pressable>
  );
}

function StatusPill({
  status,
  s,
  colors,
}: {
  status: string;
  s: any;
  colors: Colors;
}) {
  const tone =
    status === "HUMAN_APPROVED" ||
    status === "VALIDATED" ||
    status === "ACCEPTED"
      ? "green"
      : status === "REJECTED"
        ? "red"
        : status === "NEEDS_REVIEW" || status === "PENDING"
          ? "amber"
          : "blue";
  return (
    <View
      style={[
        s.statusPill,
        { backgroundColor: colors[`${tone}Soft` as keyof Colors] },
      ]}
    >
      <View
        style={[s.statusDot, { backgroundColor: colors[tone as keyof Colors] }]}
      />
      <Text style={[s.statusText, { color: colors[tone as keyof Colors] }]}>
        {statusLabels[status] ?? status}
      </Text>
    </View>
  );
}

function Section({
  s,
  title,
  hint,
  children,
}: {
  s: any;
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <View style={s.section}>
      <View style={s.sectionHead}>
        <Text style={s.sectionTitle}>{title}</Text>
        {hint && (
          <Text style={s.sectionHint} numberOfLines={1}>
            {hint}
          </Text>
        )}
      </View>
      {children}
    </View>
  );
}

function Fact({
  s,
  label,
  value,
  accent = false,
}: {
  s: any;
  label: string;
  value: unknown;
  accent?: boolean;
}) {
  return (
    <View style={s.fact}>
      <Text style={s.factLabel}>{label}</Text>
      <Text style={[s.factValue, accent && s.factAccent]} numberOfLines={2}>
        {String(value ?? "—")}
      </Text>
    </View>
  );
}

function ActionCard({
  s,
  icon,
  title,
  text,
  onPress,
}: {
  s: any;
  icon: string;
  title: string;
  text: string;
  onPress: () => void;
}) {
  return (
    <Pressable style={s.actionCard} onPress={onPress}>
      <Text style={s.actionIcon}>{icon}</Text>
      <Text style={s.actionTitle}>{title}</Text>
      <Text style={s.actionText}>{text}</Text>
    </Pressable>
  );
}

function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <Text
      style={{
        color: "#898981",
        fontSize: 11,
        fontWeight: "600",
        marginTop: 15,
        marginBottom: 7,
      }}
    >
      {children}
    </Text>
  );
}

function Empty({
  s,
  icon,
  title,
  text,
}: {
  s: any;
  icon: string;
  title: string;
  text: string;
}) {
  return (
    <View style={s.empty}>
      <Text style={s.emptyIcon}>{icon}</Text>
      <Text style={s.emptyTitle}>{title}</Text>
      <Text style={s.emptyText}>{text}</Text>
    </View>
  );
}

const sBrand = StyleSheet.create({
  wrap: { flexDirection: "row", alignItems: "center", gap: 9 },
  mark: { width: 30, height: 30, borderRadius: 9, position: "relative" },
  ring: {
    position: "absolute",
    width: 13,
    height: 13,
    borderWidth: 2,
    borderRadius: 7,
    left: 5,
    top: 5,
  },
  slash: {
    position: "absolute",
    width: 10,
    height: 2,
    borderRadius: 2,
    right: 4,
    bottom: 7,
    transform: [{ rotate: "-45deg" }],
  },
  name: { fontSize: 14, fontWeight: "700" },
});

const sTheme = StyleSheet.create({
  button: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderRadius: 9,
  },
});

function createStyles(c: Colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.canvas },
    center: { alignItems: "center", justifyContent: "center" },
    content: { flex: 1 },
    loginPage: { flexGrow: 1, padding: 20, paddingBottom: 42 },
    loginTop: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 38,
    },
    loginVisual: { marginBottom: 24 },
    kicker: {
      color: c.textFaint,
      fontSize: 9,
      letterSpacing: 1.5,
      fontWeight: "700",
      marginBottom: 8,
    },
    loginHero: {
      color: c.text,
      fontSize: 39,
      lineHeight: 42,
      letterSpacing: -1.7,
      fontWeight: "500",
      maxWidth: 350,
    },
    loginLead: {
      color: c.textSoft,
      fontSize: 14,
      lineHeight: 21,
      marginTop: 14,
      maxWidth: 330,
    },
    miniWindow: {
      height: 150,
      marginTop: 25,
      overflow: "hidden",
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.line,
      borderRadius: 13,
    },
    miniWindowBar: {
      height: 32,
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      paddingHorizontal: 11,
      borderBottomWidth: 1,
      borderBottomColor: c.line,
    },
    dot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: c.lineStrong,
    },
    miniWindowTitle: {
      color: c.textFaint,
      fontSize: 8,
      marginLeft: "auto",
      marginRight: "auto",
    },
    miniWindowBody: { padding: 20 },
    codeLine: {
      height: 7,
      marginBottom: 10,
      borderRadius: 4,
      backgroundColor: c.line,
    },
    miniResult: {
      width: "75%",
      flexDirection: "row",
      gap: 8,
      alignItems: "center",
      marginTop: 16,
      padding: 10,
      backgroundColor: c.surfaceSoft,
      borderRadius: 7,
    },
    miniResultText: { color: c.textSoft, fontSize: 9 },
    loginCard: {
      padding: 20,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.line,
      borderRadius: 15,
    },
    formKicker: { color: c.accent, fontSize: 10, fontWeight: "700" },
    formTitle: {
      color: c.text,
      fontSize: 25,
      fontWeight: "600",
      letterSpacing: -0.8,
      marginTop: 7,
    },
    formHint: {
      color: c.textSoft,
      fontSize: 12,
      marginTop: 3,
      marginBottom: 8,
    },
    input: {
      minHeight: 44,
      paddingHorizontal: 12,
      color: c.text,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.line,
      borderRadius: 9,
      fontSize: 13,
    },
    primaryButton: {
      minHeight: 46,
      marginTop: 19,
      paddingHorizontal: 15,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      backgroundColor: c.inverse,
      borderRadius: 9,
    },
    primaryButtonText: {
      color: c.inverseText,
      fontSize: 12,
      fontWeight: "700",
    },
    demoHint: {
      color: c.textFaint,
      fontSize: 8,
      textAlign: "center",
      marginTop: 15,
    },
    appHeader: {
      height: 58,
      paddingHorizontal: 15,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      backgroundColor: c.canvas,
      borderBottomWidth: 1,
      borderBottomColor: c.line,
    },
    headerActions: { flexDirection: "row", alignItems: "center", gap: 7 },
    iconButton: {
      width: 36,
      height: 36,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.line,
      borderRadius: 9,
    },
    uploadButton: {
      minHeight: 36,
      paddingHorizontal: 12,
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      backgroundColor: c.inverse,
      borderRadius: 9,
    },
    page: { padding: 16, paddingBottom: 96 },
    pageFill: { flex: 1, paddingTop: 15 },
    pageHeadingRow: {
      paddingHorizontal: 16,
      marginBottom: 13,
      flexDirection: "row",
      alignItems: "flex-end",
      justifyContent: "space-between",
    },
    pageTitle: {
      color: c.text,
      fontSize: 29,
      lineHeight: 34,
      fontWeight: "600",
      letterSpacing: -1,
    },
    pageLead: {
      color: c.textSoft,
      fontSize: 12,
      lineHeight: 18,
      marginTop: 4,
      marginBottom: 20,
    },
    smallPrimary: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      backgroundColor: c.inverse,
      borderRadius: 8,
    },
    smallPrimaryText: { color: c.inverseText, fontSize: 10, fontWeight: "700" },
    heroCard: {
      minHeight: 118,
      flexDirection: "row",
      alignItems: "center",
      marginTop: 20,
      padding: 17,
      backgroundColor: c.inverse,
      borderRadius: 14,
      overflow: "hidden",
    },
    heroCardCopy: { flex: 1 },
    heroCardKicker: {
      color: c.accent,
      fontSize: 8,
      letterSpacing: 1.2,
      fontWeight: "800",
    },
    heroCardTitle: {
      color: c.inverseText,
      fontSize: 19,
      fontWeight: "600",
      marginTop: 7,
    },
    heroCardText: { color: c.textFaint, fontSize: 9, marginTop: 4 },
    heroUpload: {
      width: 47,
      height: 47,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.accent,
      borderRadius: 13,
    },
    statsGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 9,
      marginTop: 12,
    },
    metricCard: {
      width: "48.6%",
      minHeight: 125,
      padding: 13,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.line,
      borderRadius: 11,
    },
    metricIcon: {
      width: 29,
      height: 29,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 8,
      marginBottom: 10,
    },
    metricLabel: { color: c.textSoft, fontSize: 9 },
    metricValue: {
      color: c.text,
      fontSize: 23,
      fontWeight: "600",
      marginTop: 3,
    },
    metricNote: { color: c.textFaint, fontSize: 8, marginTop: 1 },
    sectionHeader: {
      marginTop: 25,
      marginBottom: 9,
      flexDirection: "row",
      alignItems: "flex-end",
      justifyContent: "space-between",
    },
    sectionTitle: { color: c.text, fontSize: 12, fontWeight: "700" },
    sectionTitleStandalone: {
      color: c.text,
      fontSize: 12,
      fontWeight: "700",
      marginTop: 20,
      marginBottom: 9,
    },
    sectionHint: {
      color: c.textFaint,
      fontSize: 8,
      marginTop: 2,
      maxWidth: 170,
    },
    linkText: { color: c.textSoft, fontSize: 9, fontWeight: "600" },
    surfaceList: {
      overflow: "hidden",
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.line,
      borderRadius: 11,
    },
    invoiceRow: {
      minHeight: 76,
      flexDirection: "row",
      gap: 10,
      alignItems: "center",
      padding: 11,
      borderBottomWidth: 1,
      borderBottomColor: c.line,
    },
    fileIcon: {
      width: 35,
      height: 35,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.surfaceSoft,
      borderWidth: 1,
      borderColor: c.line,
      borderRadius: 9,
    },
    invoiceTitle: { color: c.text, fontSize: 11, fontWeight: "700" },
    invoiceSeller: { color: c.textSoft, fontSize: 9, marginTop: 2 },
    invoiceAmount: {
      color: c.text,
      fontSize: 9,
      fontWeight: "600",
      marginTop: 5,
    },
    invoiceSide: { alignItems: "flex-end", gap: 7 },
    invoiceDate: { color: c.textFaint, fontSize: 8 },
    governanceCard: {
      flexDirection: "row",
      gap: 10,
      marginTop: 14,
      padding: 13,
      backgroundColor: c.greenSoft,
      borderWidth: 1,
      borderColor: c.line,
      borderRadius: 10,
    },
    governanceTitle: { color: c.text, fontSize: 10, fontWeight: "700" },
    governanceText: {
      color: c.textSoft,
      fontSize: 8,
      lineHeight: 13,
      marginTop: 2,
    },
    searchBox: {
      height: 45,
      marginHorizontal: 16,
      marginBottom: 12,
      paddingHorizontal: 11,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.line,
      borderRadius: 10,
    },
    searchInput: { flex: 1, color: c.text, fontSize: 11 },
    searchButton: {
      minWidth: 53,
      height: 33,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.inverse,
      borderRadius: 7,
    },
    searchButtonText: { color: c.inverseText, fontSize: 10, fontWeight: "700" },
    invoiceList: { paddingHorizontal: 16, paddingBottom: 95, gap: 9 },
    invoiceCard: {
      padding: 13,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.line,
      borderRadius: 11,
    },
    invoiceCardTop: { flexDirection: "row", justifyContent: "space-between" },
    invoiceCardTitle: {
      color: c.text,
      fontSize: 14,
      fontWeight: "700",
      marginTop: 11,
    },
    invoiceCardSeller: { color: c.textSoft, fontSize: 10, marginTop: 2 },
    invoiceCardFooter: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginTop: 12,
      paddingTop: 10,
      borderTopWidth: 1,
      borderTopColor: c.line,
    },
    invoiceCardAmount: { color: c.text, fontSize: 11, fontWeight: "600" },
    statusPill: {
      width: "auto",
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingHorizontal: 7,
      paddingVertical: 3,
      borderRadius: 12,
    },
    statusDot: { width: 5, height: 5, borderRadius: 3 },
    statusText: { fontSize: 8, fontWeight: "600" },
    backButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      alignSelf: "flex-start",
      marginBottom: 15,
    },
    backText: { color: c.textSoft, fontSize: 10, fontWeight: "600" },
    detailTitleRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
    detailTitle: {
      color: c.text,
      fontSize: 24,
      fontWeight: "600",
      letterSpacing: -0.7,
    },
    detailSubtitle: { color: c.textSoft, fontSize: 10, marginTop: 3 },
    detailMetrics: {
      flexDirection: "row",
      marginTop: 17,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.line,
      borderRadius: 10,
    },
    detailMetric: {
      flex: 1,
      minHeight: 76,
      padding: 11,
      borderRightWidth: 1,
      borderRightColor: c.line,
    },
    detailMetricValue: {
      color: c.text,
      fontSize: 17,
      fontWeight: "600",
      marginTop: 5,
    },
    metricSuffix: { color: c.textFaint, fontSize: 8 },
    section: {
      marginTop: 13,
      overflow: "hidden",
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.line,
      borderRadius: 10,
    },
    sectionHead: {
      minHeight: 42,
      paddingHorizontal: 12,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      backgroundColor: c.surfaceSoft,
      borderBottomWidth: 1,
      borderBottomColor: c.line,
    },
    factsGrid: { flexDirection: "row", flexWrap: "wrap" },
    fact: {
      width: "50%",
      minHeight: 65,
      padding: 11,
      borderRightWidth: 1,
      borderBottomWidth: 1,
      borderColor: c.line,
    },
    factLabel: { color: c.textFaint, fontSize: 8 },
    factValue: { color: c.text, fontSize: 10, fontWeight: "600", marginTop: 5 },
    factAccent: { color: c.green },
    actionRow: { gap: 8, paddingRight: 15 },
    actionCard: {
      width: 125,
      minHeight: 86,
      padding: 11,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.line,
      borderRadius: 10,
    },
    actionIcon: { color: c.textSoft, fontSize: 17 },
    actionTitle: {
      color: c.text,
      fontSize: 10,
      fontWeight: "700",
      marginTop: 7,
    },
    actionText: { color: c.textFaint, fontSize: 8, marginTop: 2 },
    alertRow: {
      minHeight: 65,
      flexDirection: "row",
      alignItems: "center",
      gap: 9,
      padding: 11,
      borderBottomWidth: 1,
      borderBottomColor: c.line,
    },
    alertDot: { width: 7, height: 7, borderRadius: 4 },
    alertTitle: {
      color: c.text,
      fontSize: 9,
      fontWeight: "600",
      lineHeight: 14,
    },
    alertMeta: { color: c.textFaint, fontSize: 7, marginTop: 3 },
    evidenceReady: { flexDirection: "row", gap: 9, padding: 11 },
    evidenceTitle: { color: c.text, fontSize: 9, fontWeight: "700" },
    evidenceText: { color: c.textSoft, fontSize: 8, marginTop: 2 },
    disclaimer: {
      color: c.amber,
      backgroundColor: c.amberSoft,
      fontSize: 8,
      lineHeight: 13,
      margin: 10,
      padding: 9,
      borderRadius: 7,
    },
    reviewButton: {
      minHeight: 45,
      marginTop: 14,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 7,
      backgroundColor: c.inverse,
      borderRadius: 9,
    },
    queueBanner: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      marginBottom: 14,
      padding: 14,
      backgroundColor: c.amberSoft,
      borderRadius: 10,
    },
    queueCount: { color: c.amber, fontSize: 27, fontWeight: "700" },
    queueTitle: { color: c.text, fontSize: 10, fontWeight: "700" },
    queueText: { color: c.textSoft, fontSize: 8 },
    reviewRow: {
      minHeight: 78,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      padding: 11,
      borderBottomWidth: 1,
      borderBottomColor: c.line,
    },
    reviewIcon: {
      width: 35,
      height: 35,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.amberSoft,
      borderRadius: 9,
    },
    legalNotice: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginBottom: 13,
      padding: 11,
      backgroundColor: c.greenSoft,
      borderRadius: 9,
    },
    legalNoticeText: {
      flex: 1,
      color: c.textSoft,
      fontSize: 8,
      lineHeight: 13,
    },
    legalCard: {
      marginBottom: 9,
      padding: 13,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.line,
      borderRadius: 10,
    },
    legalCardTop: { flexDirection: "row", justifyContent: "space-between" },
    legalIcon: {
      width: 35,
      height: 35,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.surfaceSoft,
      borderRadius: 9,
    },
    legalTitle: {
      color: c.text,
      fontSize: 12,
      fontWeight: "600",
      lineHeight: 17,
      marginTop: 10,
    },
    legalMeta: { color: c.textSoft, fontSize: 8, marginTop: 4 },
    legalId: {
      color: c.textFaint,
      fontSize: 7,
      marginTop: 10,
      paddingTop: 9,
      borderTopWidth: 1,
      borderTopColor: c.line,
    },
    storageCard: { padding: 16, backgroundColor: c.inverse, borderRadius: 13 },
    storageTop: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    storageValue: { color: c.inverseText, fontSize: 23, fontWeight: "600" },
    storageCaption: { color: c.textFaint, fontSize: 9, marginTop: 2 },
    storageCloud: {
      width: 38,
      height: 38,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "#FFFFFF14",
      borderRadius: 10,
    },
    storageTrack: {
      height: 5,
      overflow: "hidden",
      marginTop: 18,
      backgroundColor: "#FFFFFF1A",
      borderRadius: 3,
    },
    storageProgress: {
      height: "100%",
      backgroundColor: c.accent,
      borderRadius: 3,
    },
    storageOwner: { color: c.textFaint, fontSize: 8, marginTop: 9 },
    fileUploadCard: {
      minHeight: 69,
      flexDirection: "row",
      alignItems: "center",
      gap: 11,
      marginTop: 10,
      padding: 12,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.line,
      borderRadius: 11,
    },
    fileUploadIcon: {
      width: 38,
      height: 38,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.accent,
      borderRadius: 9,
    },
    fileUploadTitle: { color: c.text, fontSize: 11, fontWeight: "700" },
    fileUploadText: { color: c.textFaint, fontSize: 8, marginTop: 3 },
    fileList: { gap: 7 },
    storedFileCard: {
      minHeight: 67,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      padding: 11,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.line,
      borderRadius: 10,
    },
    storedFileIcon: {
      width: 37,
      height: 37,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.surfaceSoft,
      borderRadius: 9,
    },
    storedFileName: { color: c.text, fontSize: 10, fontWeight: "700" },
    storedFileMeta: { color: c.textFaint, fontSize: 8, marginTop: 3 },
    storedFileTags: { color: c.blue, fontSize: 7, marginTop: 4 },
    fileDelete: { padding: 8 },
    fileDeleteText: { color: c.red, fontSize: 8, fontWeight: "700" },
    auditMobileList: { paddingHorizontal: 12 },
    auditMobileRow: {
      minHeight: 51,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      borderBottomWidth: 1,
      borderBottomColor: c.line,
    },
    auditMobileDot: { width: 6, height: 6, borderRadius: 3 },
    auditMobileAction: { color: c.text, fontSize: 9, fontWeight: "700" },
    auditMobileMeta: { color: c.textFaint, fontSize: 7, marginTop: 3 },
    themeList: { padding: 7, gap: 5 },
    themeOption: {
      minHeight: 57,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      padding: 10,
      backgroundColor: c.surfaceSoft,
      borderWidth: 1,
      borderColor: "transparent",
      borderRadius: 8,
    },
    themeOptionActive: {
      backgroundColor: c.surface,
      borderColor: c.lineStrong,
    },
    themeTitle: { color: c.text, fontSize: 10, fontWeight: "700" },
    themeText: { color: c.textFaint, fontSize: 8, marginTop: 2 },
    profileRow: {
      flexDirection: "row",
      gap: 11,
      alignItems: "center",
      padding: 13,
    },
    profileAvatar: {
      width: 43,
      height: 43,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.inverse,
      borderRadius: 11,
    },
    profileInitials: { color: c.inverseText, fontSize: 11, fontWeight: "700" },
    profileName: { color: c.text, fontSize: 11, fontWeight: "700" },
    profileEmail: { color: c.textSoft, fontSize: 9, marginTop: 2 },
    profileTenant: { color: c.textFaint, fontSize: 8, marginTop: 3 },
    logoutButton: {
      minHeight: 43,
      marginTop: 15,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.redSoft,
      borderRadius: 9,
    },
    logoutText: { color: c.red, fontSize: 10, fontWeight: "700" },
    bottomNav: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      flexDirection: "row",
      alignItems: "flex-start",
      justifyContent: "space-around",
      paddingTop: 7,
      backgroundColor: c.elevated,
      borderTopWidth: 1,
      borderTopColor: c.line,
    },
    navItem: { minWidth: 55, alignItems: "center", gap: 2 },
    navIcon: { color: c.textFaint, fontSize: 17, fontWeight: "500" },
    navLabel: { color: c.textFaint, fontSize: 7 },
    navLabelActive: { color: c.text, fontWeight: "700" },
    navBadge: {
      position: "absolute",
      right: -8,
      top: -4,
      minWidth: 14,
      height: 14,
      paddingHorizontal: 3,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.accent,
      borderRadius: 7,
    },
    navBadgeText: { color: "#FFF", fontSize: 7, fontWeight: "700" },
    busyBar: {
      position: "absolute",
      top: 62,
      right: 15,
      width: 33,
      height: 33,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.elevated,
      borderWidth: 1,
      borderColor: c.line,
      borderRadius: 9,
    },
    modalBackdrop: {
      flex: 1,
      justifyContent: "flex-end",
      backgroundColor: "#11110FA8",
    },
    modalCard: {
      padding: 18,
      backgroundColor: c.elevated,
      borderTopLeftRadius: 18,
      borderTopRightRadius: 18,
    },
    modalHandle: {
      width: 38,
      height: 4,
      alignSelf: "center",
      backgroundColor: c.lineStrong,
      borderRadius: 2,
      marginBottom: 17,
    },
    modalKicker: {
      color: c.accent,
      fontSize: 8,
      letterSpacing: 1.2,
      fontWeight: "800",
    },
    modalTitle: {
      color: c.text,
      fontSize: 22,
      fontWeight: "600",
      marginTop: 6,
    },
    modalLead: {
      color: c.textSoft,
      fontSize: 10,
      lineHeight: 15,
      marginTop: 4,
    },
    decisionPicker: {
      flexDirection: "row",
      gap: 4,
      marginTop: 18,
      padding: 4,
      backgroundColor: c.surfaceSoft,
      borderRadius: 9,
    },
    decisionOption: {
      flex: 1,
      minHeight: 35,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 6,
    },
    decisionOptionActive: { backgroundColor: c.surface },
    decisionOptionText: { color: c.textSoft, fontSize: 9, fontWeight: "600" },
    decisionOptionTextActive: { color: c.text },
    commentInput: { height: 90, paddingTop: 10 },
    empty: {
      minHeight: 180,
      alignItems: "center",
      justifyContent: "center",
      padding: 24,
    },
    emptyIcon: { color: c.textFaint, fontSize: 26 },
    emptyTitle: {
      color: c.text,
      fontSize: 11,
      fontWeight: "700",
      marginTop: 10,
    },
    emptyText: {
      color: c.textFaint,
      fontSize: 9,
      textAlign: "center",
      marginTop: 3,
    },
  });
}
