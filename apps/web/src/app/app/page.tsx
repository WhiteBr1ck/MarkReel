import { Suspense } from "react";
import AppClient from "./page.client";

export default function AppPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", padding: 24 }}>加载中...</div>}>
      <AppClient />
    </Suspense>
  );
}
