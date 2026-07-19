import { existsSync } from "node:fs";
import { chromium } from "playwright-core";

const candidates = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
];
const executablePath = candidates.find(existsSync);

if (!executablePath) {
  throw new Error(
    "Không tìm thấy trình duyệt Chromium cục bộ để chạy UI smoke test.",
  );
}

const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  colorScheme: "light",
});
await context.addInitScript(() =>
  localStorage.setItem("aicount_theme", "light"),
);
const page = await context.newPage();
const consoleErrors = [];
const apiFailures = [];
page.on("console", (message) => {
  if (message.type() !== "error") return;
  const source = message.location().url;
  if (source.includes("/.well-known/appspecific/com.chrome.devtools.json"))
    return;
  consoleErrors.push(`${message.text()}${source ? ` (${source})` : ""}`);
});
page.on("response", (response) => {
  if (response.url().includes("/api/v1/") && response.status() >= 400)
    apiFailures.push(`${response.status()} ${response.url()}`);
});

try {
  const devtoolsWorkspace = await context.request.get(
    "http://localhost:3000/.well-known/appspecific/com.chrome.devtools.json",
  );
  if (devtoolsWorkspace.status() !== 404)
    throw new Error(
      "Dev server đang công bố đường dẫn filesystem Docker cho Chrome.",
    );
  await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
  await page.locator('input[type="email"]').fill("admin@aicount.example.com");
  await page.locator('input[type="password"]').fill("ChangeMe123!");
  await page.getByRole("button", { name: /Tiếp tục/ }).click();
  await page.locator(".app-shell").waitFor();
  if (
    (await page.locator(".app-shell").getAttribute("data-dev-reload")) !==
    "webpack-polling"
  )
    throw new Error(
      "Web container chưa phục vụ bundle mới qua webpack polling.",
    );
  const sidebarAccountBlocks = await page
    .locator(".workspace-switcher, .sidebar-user")
    .count();
  if (sidebarAccountBlocks !== 0)
    throw new Error(
      "Sidebar vẫn hiển thị khối workspace hoặc hồ sơ người dùng.",
    );
  await page.locator(".overview-view").waitFor();
  const overviewDashboard = await page.evaluate(() => ({
    kpis: document.querySelectorAll(".overview-kpis article").length,
    charts: document.querySelectorAll(".overview-chart-card").length,
    activityBars: document.querySelectorAll(".activity-bars > div").length,
    systemServices: document.querySelectorAll(".system-health-grid > div")
      .length,
  }));
  if (
    overviewDashboard.kpis !== 4 ||
    overviewDashboard.charts !== 4 ||
    overviewDashboard.activityBars !== 7 ||
    overviewDashboard.systemServices !== 4
  )
    throw new Error(
      `Dashboard Tổng quan chưa đủ biểu đồ: ${JSON.stringify(overviewDashboard)}`,
    );
  await page.screenshot({
    path: "tests/artifacts/system-overview-light.png",
    fullPage: true,
  });
  const layout = await page.evaluate(() => {
    const sidebar = document.querySelector(".app-shell > .sidebar");
    const workspace = document.querySelector(".workspace");
    if (!sidebar || !workspace) throw new Error("Thiếu cấu trúc workspace");
    return {
      sidebarPosition: getComputedStyle(sidebar).position,
      workspaceOverflowY: getComputedStyle(workspace).overflowY,
      workspaceHeight: workspace.getBoundingClientRect().height,
      viewportHeight: window.innerHeight,
    };
  });
  if (layout.sidebarPosition !== "fixed")
    throw new Error(
      `Sidebar desktop chưa được cố định: ${JSON.stringify(layout)}`,
    );
  if (layout.workspaceOverflowY !== "auto")
    throw new Error("Workspace chưa có vùng cuộn độc lập.");
  if (Math.abs(layout.workspaceHeight - layout.viewportHeight) > 2)
    throw new Error("Workspace không khớp chiều cao viewport.");
  await page.locator(".navigation .nav-item", { hasText: "Hóa đơn" }).click();
  const workbenchSurfaces = await page.evaluate(() => {
    const workbench = document.querySelector(".workbench");
    const queue = document.querySelector(".invoice-queue");
    const inspector = document.querySelector(".inspector");
    if (!workbench || !queue || !inspector)
      throw new Error("Thiếu cấu trúc workbench.");
    const workbenchStyle = getComputedStyle(workbench);
    const workspace = document.querySelector(".workspace");
    if (!workspace) throw new Error("Thiếu workspace.");
    return {
      wrapperBorder: workbenchStyle.borderTopWidth,
      wrapperBackground: workbenchStyle.backgroundColor,
      gap: workbenchStyle.columnGap,
      queueBorder: getComputedStyle(queue).borderTopWidth,
      inspectorBorder: getComputedStyle(inspector).borderTopWidth,
      queueRadius: getComputedStyle(queue).borderTopLeftRadius,
      inspectorRadius: getComputedStyle(inspector).borderTopRightRadius,
      workbenchLeft: workbench.getBoundingClientRect().left,
      workspaceLeft: workspace.getBoundingClientRect().left,
      queueRight: queue.getBoundingClientRect().right,
      inspectorLeft: inspector.getBoundingClientRect().left,
    };
  });
  if (
    workbenchSurfaces.wrapperBorder !== "0px" ||
    workbenchSurfaces.wrapperBackground !== "rgba(0, 0, 0, 0)" ||
    workbenchSurfaces.gap !== "0px" ||
    workbenchSurfaces.queueBorder === "0px" ||
    workbenchSurfaces.inspectorBorder === "0px" ||
    workbenchSurfaces.queueRadius !== "0px" ||
    workbenchSurfaces.inspectorRadius !== "0px" ||
    Math.abs(
      workbenchSurfaces.workbenchLeft - workbenchSurfaces.workspaceLeft,
    ) > 1 ||
    Math.abs(workbenchSurfaces.queueRight - workbenchSurfaces.inspectorLeft) > 1
  )
    throw new Error(
      `WorkBench chưa liền sidebar hoặc vẫn còn góc bo: ${JSON.stringify(workbenchSurfaces)}`,
    );
  await page.locator("footer.decision-footer").waitFor();
  const decisionLayout = await page.evaluate(() => {
    const inspector = document.querySelector(".inspector");
    const footer = inspector?.querySelector("footer.decision-footer");
    const invoiceHeader = inspector?.querySelector(".inspector-head");
    const inspectorScroll = inspector?.querySelector(".inspector-scroll");
    const invoiceList = document.querySelector(".invoice-list");
    const analysis = inspector?.querySelector(".analysis-section");
    const ruleDecision = inspector?.querySelector(".rule-decision-card");
    if (
      !inspector ||
      !footer ||
      !invoiceHeader ||
      !inspectorScroll ||
      !invoiceList ||
      !analysis
    )
      throw new Error("Thiếu bố cục phân tích hoặc decision footer.");
    const footerTopBefore = footer.getBoundingClientRect().top;
    const queueTopBefore = invoiceList.getBoundingClientRect().top;
    const queueScrollBefore = invoiceList.scrollTop;
    inspectorScroll.scrollTop = inspectorScroll.scrollHeight;
    return {
      footerTag: footer.tagName,
      footerBottom: footer.getBoundingClientRect().bottom,
      invoiceHeaderTop: invoiceHeader.getBoundingClientRect().top,
      footerBeforeInvoiceHeader: footer.nextElementSibling === invoiceHeader,
      footerStayedFixed:
        Math.abs(footerTopBefore - footer.getBoundingClientRect().top) <= 1,
      inspectorScrolled: inspectorScroll.scrollTop > 0,
      queueStayedFixed:
        invoiceList.scrollTop === queueScrollBefore &&
        Math.abs(queueTopBefore - invoiceList.getBoundingClientRect().top) <= 1,
      actionCount: footer.querySelectorAll("button").length,
      ruleDecisionInsideAnalysis:
        !ruleDecision || analysis.contains(ruleDecision),
    };
  });
  if (
    decisionLayout.footerTag !== "FOOTER" ||
    decisionLayout.footerBottom > decisionLayout.invoiceHeaderTop + 1 ||
    !decisionLayout.footerBeforeInvoiceHeader ||
    !decisionLayout.footerStayedFixed ||
    !decisionLayout.inspectorScrolled ||
    !decisionLayout.queueStayedFixed ||
    decisionLayout.actionCount !== 3 ||
    !decisionLayout.ruleDecisionInsideAnalysis
  )
    throw new Error(
      `Human Review chưa nằm trên tiêu đề hoặc vùng cuộn chưa độc lập: ${JSON.stringify(decisionLayout)}`,
    );
  await page.screenshot({
    path: "tests/artifacts/workspace-unwrapped-light.png",
    fullPage: true,
  });
  await page.evaluate(() => {
    const workspace = document.querySelector(".workspace");
    const inspectorScroll = document.querySelector(".inspector-scroll");
    if (workspace) workspace.scrollTop = workspace.scrollHeight;
    if (inspectorScroll)
      inspectorScroll.scrollTop = inspectorScroll.scrollHeight;
  });
  await page.screenshot({
    path: "tests/artifacts/decision-header-light.png",
    fullPage: true,
  });
  await page.evaluate(() => {
    const workspace = document.querySelector(".workspace");
    if (workspace) workspace.scrollTop = 0;
  });
  await page.locator(".navigation .nav-item", { hasText: "Tổng quan" }).click();
  const scrollIsolation = await page.evaluate(() => {
    const sidebar = document.querySelector(".app-shell > .sidebar");
    const workspace = document.querySelector(".workspace");
    if (!sidebar || !workspace) return null;
    const before = sidebar.getBoundingClientRect().top;
    workspace.scrollTop = 180;
    const after = sidebar.getBoundingClientRect().top;
    const workspaceScrolled = workspace.scrollTop > 0;
    workspace.scrollTop = 0;
    return { before, after, workspaceScrolled };
  });
  if (
    !scrollIsolation?.workspaceScrolled ||
    Math.abs(scrollIsolation.before - scrollIsolation.after) > 1
  )
    throw new Error("Cuộn workspace đang làm dịch chuyển sidebar.");

  await page.keyboard.press("Control+K");
  await page.locator(".command-palette").waitFor();
  const commandInput = page.locator(".command-input-row input");
  await commandInput.fill("99/2025/TT-BTC");
  await page
    .locator(".command-results button", { hasText: "99/2025/TT-BTC" })
    .first()
    .waitFor();
  await page.screenshot({
    path: "tests/artifacts/command-center-light.png",
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await page.locator(".command-palette").waitFor({ state: "hidden" });

  await page
    .getByRole("button", { name: "Thư viện pháp lý", exact: true })
    .click();
  await page.locator(".legal-document-item").first().waitFor();
  const legalDocuments = await page.locator(".legal-document-item").count();
  if (legalDocuments !== 31)
    throw new Error(`Explorer không hiển thị đủ 31 văn bản: ${legalDocuments}`);
  await page.locator(".legal-pdf-frame").waitFor({ timeout: 30_000 });
  const legalWorkbench = await page.evaluate(() => {
    const explorer = document.querySelector(".legal-explorer");
    const editor = document.querySelector(".legal-editor");
    const iframe = document.querySelector(".legal-pdf-frame");
    if (!explorer || !editor || !iframe)
      throw new Error("Thiếu Explorer, editor hoặc PDF preview.");
    return {
      explorerRight: explorer.getBoundingClientRect().right,
      editorLeft: editor.getBoundingClientRect().left,
      explorerRadius: getComputedStyle(explorer).borderTopLeftRadius,
      iframeSource: iframe.getAttribute("src"),
    };
  });
  if (
    Math.abs(legalWorkbench.explorerRight - legalWorkbench.editorLeft) > 1 ||
    legalWorkbench.explorerRadius !== "0px" ||
    !legalWorkbench.iframeSource?.startsWith("blob:")
  )
    throw new Error(
      `Legal workbench chưa liền khối hoặc PDF chưa dùng nguồn xác thực: ${JSON.stringify(legalWorkbench)}`,
    );
  await page.screenshot({
    path: "tests/artifacts/legal-workbench-preview-light.png",
    fullPage: true,
  });
  await page.locator(".legal-search-box .primary-button").click();
  await page.locator(".legal-result").first().waitFor();
  await page.locator(".legal-statusbar").waitFor();
  await page.locator(".legal-assessment").waitFor();
  await page.locator(".legal-locator").first().waitFor();
  const legalResults = await page.locator(".legal-result").count();
  const groundedResults = await page.locator(".legal-locator").count();
  if (groundedResults !== legalResults)
    throw new Error("Bộ lọc PDF đã xác minh vẫn trả kết quả thiếu locator.");
  await page
    .locator(".legal-result")
    .first()
    .getByRole("button", { name: /Preview/ })
    .click();
  await page.locator(".legal-pdf-frame").waitFor();

  await page
    .getByRole("button", { name: /Hóa đơn/ })
    .first()
    .click();
  await page.locator(".invoice-card").first().click();
  await page.getByRole("button", { name: "Bằng chứng", exact: true }).click();
  await page.locator(".evidence-ready").waitFor();

  await page.getByTitle("Hiệu chỉnh dữ liệu").click();
  await page.getByRole("heading", { name: "Hiệu chỉnh dữ liệu" }).waitFor();
  const modalAppearance = await page.evaluate(() => {
    const modal = document.querySelector(".correction-modal");
    const submit = modal?.querySelector(".primary-button");
    if (!modal || !submit)
      throw new Error("Thiếu thành phần modal hiệu chỉnh.");
    return {
      modalBackground: getComputedStyle(modal).backgroundColor,
      modalOpacity: getComputedStyle(modal).opacity,
      submitBackground: getComputedStyle(submit).backgroundColor,
      bodyOverflow: getComputedStyle(document.body).overflow,
    };
  });
  const transparent = new Set(["transparent", "rgba(0, 0, 0, 0)"]);
  if (
    transparent.has(modalAppearance.modalBackground) ||
    transparent.has(modalAppearance.submitBackground) ||
    modalAppearance.modalOpacity !== "1" ||
    modalAppearance.bodyOverflow !== "hidden"
  )
    throw new Error(
      `Modal chưa có surface đặc hoặc chưa khóa nền: ${JSON.stringify(modalAppearance)}`,
    );
  await page.screenshot({
    path: "tests/artifacts/correction-modal-light.png",
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await page.locator(".correction-modal").waitFor({ state: "hidden" });

  await page.getByRole("button", { name: "Cài đặt", exact: true }).click();
  await page.locator(".identity-settings-card").waitFor();
  const settingsInformation = await page.evaluate(() => ({
    details: document.querySelectorAll(".settings-detail-grid > div").length,
    workspaceMetrics: document.querySelectorAll(
      ".workspace-settings-metrics > div",
    ).length,
    accountActions: document.querySelectorAll(
      ".settings-account-actions button",
    ).length,
  }));
  if (
    settingsInformation.details < 6 ||
    settingsInformation.workspaceMetrics < 6 ||
    settingsInformation.accountActions < 2
  )
    throw new Error(
      `Trang Cài đặt chưa hiển thị đủ thông tin: ${JSON.stringify(settingsInformation)}`,
    );
  await page.screenshot({
    path: "tests/artifacts/settings-expanded-light.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: /^Tối/ }).click();
  if ((await page.locator("html").getAttribute("data-theme")) !== "dark") {
    throw new Error("Theme tối không được áp dụng lên document.");
  }
  await page.getByRole("button", { name: /^Sáng/ }).click();
  if ((await page.locator("html").getAttribute("data-theme")) !== "light") {
    throw new Error("Theme sáng không được áp dụng lên document.");
  }
  await page.getByRole("button", { name: /^Hệ thống/ }).click();
  if ((await page.locator("html").getAttribute("data-theme")) !== null) {
    throw new Error("Theme hệ thống phải bỏ override trên document.");
  }
  if (
    (await page
      .locator("html")
      .evaluate((element) => getComputedStyle(element).colorScheme)) !== "light"
  ) {
    throw new Error("Theme hệ thống chưa theo color scheme sáng của thiết bị.");
  }
  await page
    .getByRole("button", { name: /Hóa đơn/ })
    .first()
    .click();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "tests/artifacts/workspace-mobile-web.png",
    fullPage: true,
  });

  if (consoleErrors.length || apiFailures.length)
    throw new Error(
      `Có lỗi console/API ngoài dự kiến trước bài kiểm tra hết phiên: ${JSON.stringify({ consoleErrors, apiFailures })}`,
    );

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.route("**/api/v1/legal/corpus/status", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({
        code: "UNAUTHORIZED",
        message: "Invalid or expired access token",
      }),
    }),
  );
  const unauthorizedRequest = page.waitForRequest((request) =>
    request.url().includes("/api/v1/legal/corpus/status"),
  );
  await page
    .getByRole("button", { name: "Thư viện pháp lý", exact: true })
    .click();
  await unauthorizedRequest;
  await page.locator(".login-page").waitFor();
  await page.getByText(/Phiên đăng nhập đã hết hạn/).waitFor();
  const rejectedSessionState = await page.evaluate(() => ({
    accounts: JSON.parse(sessionStorage.getItem("aicount_accounts_v2") ?? "[]"),
    active: sessionStorage.getItem("aicount_active_account_v2"),
  }));
  if (rejectedSessionState.accounts.length || rejectedSessionState.active)
    throw new Error("Phiên nhận 401 chưa được xóa khỏi sessionStorage.");

  await page.unroute("**/api/v1/legal/corpus/status");
  await page.locator('input[type="password"]').fill("ChangeMe123!");
  await page.getByRole("button", { name: /Tiếp tục/ }).click();
  await page.locator(".app-shell").waitFor();
  await page.evaluate(() => {
    const accounts = JSON.parse(
      sessionStorage.getItem("aicount_accounts_v2") ?? "[]",
    );
    const token = accounts[0]?.token;
    if (!token) throw new Error("Không tìm thấy token để kiểm tra thời hạn.");
    const [header, encodedPayload, signature] = token.split(".");
    const normalized = encodedPayload.replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(
      atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")),
    );
    payload.exp = Math.floor(Date.now() / 1000) - 5;
    const expiredPayload = btoa(JSON.stringify(payload))
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
    accounts[0].token = `${header}.${expiredPayload}.${signature}`;
    sessionStorage.setItem("aicount_accounts_v2", JSON.stringify(accounts));
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".login-page").waitFor();
  await page.getByText(/Phiên đăng nhập đã hết hạn/).waitFor();

  console.log(
    JSON.stringify({
      legalResults,
      legalDocuments,
      commandCenter: true,
      authenticatedPdfPreview: true,
      legalExplorerAttached: true,
      overviewDashboard,
      sidebarAccountBlocksHidden: true,
      expandedSettingsInformation: true,
      fixedSidebar: true,
      independentWorkspaceScroll: true,
      squareEdgeWorkbench: true,
      structuredAnalysisLayout: true,
      humanReviewAboveInvoiceHeader: true,
      independentInvoicePaneScroll: true,
      groundedLegalLocator: true,
      clearLegalAssessment: true,
      evidence: true,
      correctionModal: true,
      opaqueModalSurface: true,
      modalScrollLock: true,
      themes: ["system", "light", "dark"],
      unauthorizedRedirect: true,
      proactiveExpiryRedirect: true,
      invalidDockerWorkspaceSuppressed: true,
    }),
  );
} catch (error) {
  console.error("URL:", page.url());
  console.error(
    "Nội dung:",
    (await page.locator("body").innerText()).slice(0, 800),
  );
  throw error;
} finally {
  await browser.close();
}
