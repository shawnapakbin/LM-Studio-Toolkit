import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  onError: (message: string) => void;
}

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: "" };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Renderer error:", error, info);
    this.props.onError(`${error.message}\n${info.componentStack ?? ""}`);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-8 text-rose-200">
          <h2 className="text-xl font-semibold">Renderer crashed</h2>
          <pre className="mt-3 whitespace-pre-wrap text-sm">{this.state.message}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}
