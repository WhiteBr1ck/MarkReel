import { Suspense } from "react";
import AppClient from "./app/page.client";

export default function HomePage() {
  return (
    <Suspense fallback={<div className="mr-app-loading">加载中...</div>}>
      <AppClient />
    </Suspense>
  );
}
