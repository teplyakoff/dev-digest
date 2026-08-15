/* hooks/ barrel — every React Query hook over the F1/feature APIs.
   Import from "@/lib/hooks" for the platform hooks (settings/repos/pulls/context)
   or from a domain file directly (e.g. "@/lib/hooks/reviews") — both resolve here. */
export * from "./core";
export * from "./agents";
export * from "./reviews";
// `./intent` is deliberately NOT re-exported here: frontend-architecture §12
// forbids growing a barrel, and adding the line is a lint error rather than a
// style note (the baseline covers the five that predate the rule, not a sixth).
// Import it directly — `@/lib/hooks/intent`.
export * from "./trace";
export * from "./repo-intel";
