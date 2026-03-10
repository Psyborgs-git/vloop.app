import type {
    AppComponent,
    AppComponentContext,
} from "@orch/shared";
import type { DependencyContainer } from "tsyringe";

const config: AppComponent = {
    name: "@orch/media",

    register(_container: DependencyContainer) {
        // Media routes create adapters on-demand; no DI bindings required yet.
    },

    init(_ctx: AppComponentContext) {
        // No initialization needed.
    },

    start(_ctx: AppComponentContext) {
        // No background runtime to start.
    },

    stop(_ctx: AppComponentContext) {
        // No background runtime to stop.
    },

    cleanup(_ctx: AppComponentContext) {
        // No persistent resources to release.
    },
};

export default config;
