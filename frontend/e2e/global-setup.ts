import { request } from "@playwright/test";

/** Points the gateway at the local mock Snippe (backend/tools/mock_snippe.py) and passes its diagnostics. */
export default async function setup() {
  const base = process.env.BASE ?? "http://localhost:3000";
  const api = await request.newContext({ baseURL: base });
  const login = await api.post("/api/v1/auth/login/", { data: { phone: "255754000001", password: "darasa-demo-2026" } });
  if (!login.ok()) throw new Error(`Admin login failed: ${login.status()}. Run make seed first.`);
  const state = await api.storageState();
  const csrf = state.cookies.find((c) => c.name === "csrf_token")!.value;
  const headers = { "X-CSRF-Token": csrf };
  const saved = await api.patch("/api/v1/admin/settings/payments/", { headers, data: { api_base_url: "http://localhost:9100", api_key: "snp_mock_key_for_development", webhook_secret: "whsec_mock", is_enabled: false } });
  if (!saved.ok()) throw new Error(`Saving gateway failed: ${await saved.text()}`);
  for (const step of ["config", "auth", "probe", "webhook", "hosted"]) {
    const r = await api.post("/api/v1/admin/settings/payments/test/", { headers, data: { step } });
    if (!r.ok()) throw new Error(`Diagnostic ${step} failed: ${await r.text()}`);
  }
  const on = await api.patch("/api/v1/admin/settings/payments/", { headers, data: { is_enabled: true } });
  if (!on.ok()) throw new Error(`Enable failed: ${await on.text()}`);
  await api.dispose();
}
