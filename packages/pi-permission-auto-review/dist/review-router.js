// src/reviewer/review-router.ts
const UNAVAILABLE = /* @__PURE__ */ new Set([
	"provider-unresolved",
	"model-unresolved",
	"provider-error",
	"timeout",
	"attempt-timeout"
]);
/**
* 優先モデルで審査し、利用できない場合だけ fallback のモデルで同じ操作を審査する。
* 障害後は cooldownMs の間、切替先を直接使い、経過後の審査で優先モデルの復旧を確かめる。
*/
function createReviewRouter(runtime, runReview) {
	const { config } = runtime;
	const fallback = config.fallback === false ? void 0 : config.fallback;
	let retryAfter = 0;
	let probing = false;
	const cancelled = () => runtime.sessionSignal.aborted || runtime.context.signal?.aborted === true;
	const cancelledResult = () => ({
		kind: "failed",
		failure: "cancelled"
	});
	return async (details) => {
		const attempts = [];
		let fallbackReason;
		const attempt = async (target, primary) => {
			const started = Date.now();
			let result;
			try {
				result = await runReview({
					...runtime,
					config: fallback === void 0 ? target : {
						...target,
						maxRetries: 0,
						followUpReviews: "off"
					}
				}, details);
			} catch (error) {
				if (!cancelled()) throw error;
				result = {
					kind: "failed",
					failure: "cancelled"
				};
			}
			if (cancelled()) result = {
				kind: "failed",
				failure: "cancelled",
				...result.fields === void 0 ? {} : { fields: result.fields },
				...result.usage === void 0 ? {} : { usage: result.usage }
			};
			attempts.push({
				provider: target.provider,
				model: target.model,
				outcome: result.kind === "failed" ? result.failure : result.kind,
				durationMs: Math.max(0, Date.now() - started)
			});
			return {
				...result,
				diagnostics: {
					provider: target.provider,
					model: target.model,
					reviewAttempts: [...attempts],
					...primary ? {} : { fallbackReason }
				}
			};
		};
		if (cancelled()) return cancelledResult();
		if (fallback === void 0) return attempt(config, true);
		if (Date.now() < retryAfter || probing) fallbackReason = probing ? "recovery-probe-in-flight" : "primary-cooldown";
		else {
			const recovery = retryAfter > 0;
			if (recovery) probing = true;
			try {
				const result = await attempt(config, true);
				if (result.kind !== "failed" || !UNAVAILABLE.has(result.failure)) {
					if (result.kind !== "failed") retryAfter = 0;
					return result;
				}
				retryAfter = Date.now() + fallback.cooldownMs;
				fallbackReason = result.failure;
			} finally {
				if (recovery) probing = false;
			}
		}
		if (cancelled()) return cancelledResult();
		return attempt({
			...config,
			...fallback,
			fallback: false
		}, false);
	};
}

export { createReviewRouter };
//# sourceMappingURL=review-router.js.map