import { Component, type ErrorInfo, type ReactNode, useEffect, useState } from "react";

import { DashboardPage } from "./pages/DashboardPage";
import { WizardPage } from "./pages/WizardPage";

type Page = "wizard" | "dashboard";

class AppErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };

  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep diagnostics visible in packaged builds.
    console.error("Installer renderer crashed", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-app text-app-foreground">
          <main className="mx-auto flex min-h-screen max-w-[960px] items-center px-6 py-8">
            <section className="w-full rounded-3xl border border-white/10 bg-white/5 p-8 shadow-[0_20px_80px_rgba(0,0,0,0.2)]">
              <span className="eyebrow">Startup Error</span>
              <h1 className="mt-4 text-4xl font-semibold text-white">
                The installer UI failed to render.
              </h1>
              <p className="mt-3 text-app-muted">
                The error is shown below instead of leaving the window blank.
              </p>
              <pre className="mt-6 overflow-auto rounded-2xl border border-white/10 bg-[#09100e] p-4 text-sm text-[#dcf7e6]">
                {this.state.error}
              </pre>
            </section>
          </main>
        </div>
      );
    }

    return this.props.children;
  }
}

export function App() {
  const [page, setPage] = useState<Page>("wizard");
  const hasElectronApi = typeof window !== "undefined" && typeof window.electronAPI !== "undefined";

  useEffect(() => {
    document.title = "LLM Toolkit Installer";
  }, []);

  if (!hasElectronApi) {
    return (
      <div className="min-h-screen bg-app text-app-foreground">
        <main className="mx-auto flex min-h-screen max-w-[960px] items-center px-6 py-8">
          <section className="w-full rounded-3xl border border-white/10 bg-white/5 p-8 shadow-[0_20px_80px_rgba(0,0,0,0.2)]">
            <span className="eyebrow">Startup Error</span>
            <h1 className="mt-4 text-4xl font-semibold text-white">
              The installer preload bridge was not available.
            </h1>
            <p className="mt-3 text-app-muted">
              This usually means the packaged renderer failed to connect to Electron preload APIs.
              The app now surfaces this state directly instead of showing a black screen.
            </p>
          </section>
        </main>
      </div>
    );
  }

  return (
    <AppErrorBoundary>
      <div className="min-h-screen bg-app text-app-foreground">
        <main className="mx-auto flex min-h-screen w-full max-w-[1280px] flex-col overflow-auto px-4 py-4 lg:px-5 lg:py-5">
          {page === "wizard" ? (
            <WizardPage onComplete={() => {}} onOpenDashboard={() => setPage("dashboard")} />
          ) : (
            <DashboardPage onBackToWizard={() => setPage("wizard")} />
          )}
        </main>
      </div>
    </AppErrorBoundary>
  );
}
