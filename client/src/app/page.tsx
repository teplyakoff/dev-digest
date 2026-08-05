/* Root — sends the user to the first repo's PR list, or onboarding if no repos. */
"use client";

import { HomeRedirectView } from "./_components/HomeRedirectView/HomeRedirectView";

export default function HomePage() {
  return <HomeRedirectView />;
}
