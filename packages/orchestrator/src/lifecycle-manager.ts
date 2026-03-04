/**
 * ComponentLifecycleManager — Dependency-aware component lifecycle orchestration.
 *
 * Drives the full lifecycle of installed AppComponents:
 *   register → init → start → … → stop → cleanup
 *
 * Components are ordered via topological sort of their `dependencies` field.
 * Start phases run in dependency order; stop/cleanup run in reverse order.
 */

import type { DependencyContainer } from "tsyringe";
import type { Logger } from "@orch/daemon";
import type {
	AppComponent,
	AppComponentContext,
	ComponentStateValue,
	ComponentStatus,
} from "@orch/shared";
import { ComponentState } from "@orch/shared";

export class ComponentLifecycleManager {
	private ordered: AppComponent[] = [];
	private states = new Map<string, ComponentStateValue>();
	private timestamps = new Map<
		string,
		{ startedAt?: string; stoppedAt?: string }
	>();
	private errors = new Map<string, string>();

	constructor(private logger: Logger) {}

	/** Load components and compute dependency order. */
	load(components: AppComponent[]): void {
		this.ordered = this.orderByDependencies(components);
		for (const c of this.ordered) {
			this.states.set(c.name, ComponentState.Created);
			this.timestamps.set(c.name, {});
		}
	}

	/** Call register() on every component in dependency order. */
	async registerAll(container: DependencyContainer): Promise<void> {
		for (const component of this.ordered) {
			this.logger.debug(
				{ component: component.name },
				"Registering component",
			);
			component.register(container);
			this.states.set(component.name, ComponentState.Registered);
			this.logger.info(
				{ component: component.name },
				"Component registered",
			);
		}
	}

	/** Call init() on every component in dependency order. */
	async initAll(ctx: AppComponentContext): Promise<void> {
		for (const component of this.ordered) {
			this.logger.debug(
				{ component: component.name },
				"Initializing component",
			);
			await component.init(ctx);
			this.states.set(component.name, ComponentState.Initialized);
		}
	}

	/** Call start() on every component in dependency order (resilient). */
	async startAll(ctx: AppComponentContext): Promise<void> {
		for (const component of this.ordered) {
			await this.startOne(component, ctx);
		}
	}

	/** Call stop() on every component in reverse dependency order. */
	async stopAll(ctx: AppComponentContext): Promise<void> {
		for (let i = this.ordered.length - 1; i >= 0; i--) {
			await this.stopOne(this.ordered[i]!, ctx);
		}
	}

	/** Call cleanup() on every component in reverse dependency order. */
	async cleanupAll(ctx: AppComponentContext): Promise<void> {
		for (let i = this.ordered.length - 1; i >= 0; i--) {
			const component = this.ordered[i]!;
			try {
				this.logger.debug(
					{ component: component.name },
					"Cleaning up component",
				);
				await component.cleanup(ctx);
				this.states.set(component.name, ComponentState.Destroyed);
			} catch (err) {
				this.logger.error(
					{ err, component: component.name },
					"Error during component cleanup",
				);
				this.errors.set(
					component.name,
					err instanceof Error ? err.message : String(err),
				);
			}
		}
	}

	/** Stop then start a single component by name. */
	async restartComponent(
		name: string,
		ctx: AppComponentContext,
	): Promise<void> {
		const component = this.ordered.find((c) => c.name === name);
		if (!component) throw new Error(`Component not found: ${name}`);

		if (this.states.get(name) === ComponentState.Running) {
			await this.stopOne(component, ctx);
		}
		await this.startOne(component, ctx);
	}

	getStatus(name: string): ComponentStatus | undefined {
		const state = this.states.get(name);
		if (!state) return undefined;
		const ts = this.timestamps.get(name);
		return {
			name,
			state,
			startedAt: ts?.startedAt,
			stoppedAt: ts?.stoppedAt,
			error: this.errors.get(name),
		};
	}

	getAllStatuses(): ComponentStatus[] {
		return this.ordered.map((c) => this.getStatus(c.name)!);
	}

	getComponents(): readonly AppComponent[] {
		return this.ordered;
	}

	// ── Internal helpers ─────────────────────────────────────────────────

	private async startOne(
		component: AppComponent,
		ctx: AppComponentContext,
	): Promise<void> {
		try {
			this.logger.debug(
				{ component: component.name },
				"Starting component",
			);
			await component.start(ctx);
			this.states.set(component.name, ComponentState.Running);
			this.timestamps.set(component.name, {
				...this.timestamps.get(component.name),
				startedAt: new Date().toISOString(),
			});
			this.errors.delete(component.name);

			// Auto-register health check if the component provides one
			if (component.healthCheck) {
				ctx.healthRegistry.registerSubsystem(component.name, () =>
					component.healthCheck!(ctx),
				);
			}

			this.logger.info(
				{ component: component.name },
				"Component started",
			);
		} catch (err) {
			this.states.set(component.name, ComponentState.Error);
			this.errors.set(
				component.name,
				err instanceof Error ? err.message : String(err),
			);
			this.logger.error(
				{ err, component: component.name },
				"Failed to start component",
			);
		}
	}

	private async stopOne(
		component: AppComponent,
		ctx: AppComponentContext,
	): Promise<void> {
		try {
			this.logger.debug(
				{ component: component.name },
				"Stopping component",
			);
			await component.stop(ctx);
			this.states.set(component.name, ComponentState.Stopped);
			this.timestamps.set(component.name, {
				...this.timestamps.get(component.name),
				stoppedAt: new Date().toISOString(),
			});
			this.errors.delete(component.name);
		} catch (err) {
			this.states.set(component.name, ComponentState.Error);
			this.errors.set(
				component.name,
				err instanceof Error ? err.message : String(err),
			);
			this.logger.error(
				{ err, component: component.name },
				"Error stopping component",
			);
		}
	}

	private orderByDependencies(components: AppComponent[]): AppComponent[] {
		const byName = new Map(components.map((c) => [c.name, c]));
		const visited = new Set<string>();
		const inStack = new Set<string>();
		const ordered: AppComponent[] = [];

		const visit = (name: string) => {
			if (visited.has(name)) return;
			if (inStack.has(name)) {
				throw new Error(
					`Circular component dependency detected at ${name}`,
				);
			}
			const component = byName.get(name);
			if (!component) return;

			inStack.add(name);
			for (const dep of component.dependencies ?? []) {
				visit(dep);
			}
			inStack.delete(name);
			visited.add(name);
			ordered.push(component);
		};

		for (const component of components) {
			visit(component.name);
		}
		return ordered;
	}
}
