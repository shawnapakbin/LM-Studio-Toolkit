import { useEffect, useState } from "react";

import { DashboardPage } from "./pages/DashboardPage";
import { WizardPage } from "./pages/WizardPage";

type Page = "wizard" | "dashboard";

export function App() {
  const [page, setPage] = useState<Page>("wizard");

  useEffect(() => {
    document.title = "LLM Toolkit Installer";
  }, []);

  return (
    <div className="min-h-screen bg-app text-app-foreground">
      <main className="mx-auto flex min-h-screen w-full max-w-[1500px] flex-col px-6 py-8">
        {page === "wizard" ? (
          <WizardPage onComplete={() => setPage("dashboard")} onOpenDashboard={() => setPage("dashboard")} />
        ) : (
          <DashboardPage onBackToWizard={() => setPage("wizard")} />
        )}
      </main>
    </div>
  );
}