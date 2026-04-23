import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { Button } from "@/app/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/app/components/ui/card";
import { getPortalWorkspaceState } from "@/lib/portal-state";

import { PortalTextareaField } from "../PortalFields";
import { saveKnowledgeBaseAction } from "../actions";

export default async function PortalKnowledgeBasePage() {
  const portalState = await getPortalWorkspaceState();
  const isReviewed = portalState.sections.find(
    (section) => section.key === "knowledgeBase"
  )?.complete;
  const primaryLabel = portalState.launched ? "Save changes" : "Save and continue";
  const returnHref = portalState.launched ? "/portal/app/overview" : "/portal/app/onboarding";
  const returnLabel = portalState.launched ? "Back to overview" : "Back to onboarding";

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <p className="text-sm font-medium uppercase tracking-[0.16em] text-[#6a7b7e]">
          Knowledge Base
        </p>
        <h2 className="text-3xl font-semibold tracking-[-0.05em] text-[#10272c]">
          Practice knowledge
        </h2>
        <p className="max-w-2xl text-base leading-relaxed text-[#617477]">
          Keep this short and structured. Add only what the agent needs to say and do correctly.
        </p>
      </section>

      <Card className="rounded-[1.8rem] border-black/6 bg-white">
        <CardHeader>
          <CardTitle>{isReviewed ? "Knowledge saved" : "Finish this step"}</CardTitle>
          <CardDescription>
            FAQs, prep, policies, after-hours, and required phrases.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={saveKnowledgeBaseAction} className="grid gap-4">
            <PortalTextareaField
              defaultValue={portalState.draft.knowledgeCommonQuestions}
              label="Common questions"
              name="knowledgeCommonQuestions"
              placeholder="Do you take walk-ins? How do I send a referral?"
              rows={3}
            />
            <PortalTextareaField
              defaultValue={portalState.draft.knowledgeAppointmentPrep}
              label="Appointment prep"
              name="knowledgeAppointmentPrep"
              placeholder="Dilated exam patients should bring sunglasses and arrive 15 minutes early."
              rows={3}
            />
            <PortalTextareaField
              defaultValue={portalState.draft.knowledgeOfficePolicies}
              label="Office policies"
              name="knowledgeOfficePolicies"
              placeholder="Late arrivals over 15 minutes may need rescheduling."
              rows={3}
            />
            <PortalTextareaField
              defaultValue={portalState.draft.knowledgeAfterHours}
              label="After-hours rules"
              name="knowledgeAfterHours"
              placeholder="Urgent flashes, floaters, or vision loss should be transferred immediately."
              rows={3}
            />
            <PortalTextareaField
              defaultValue={portalState.draft.knowledgePhrases}
              label="Always say / never say"
              name="knowledgePhrases"
              placeholder="Always confirm callback timing. Never promise same-day availability."
              rows={3}
            />

            <div className="flex flex-col gap-3 sm:flex-row">
              <Button type="submit" variant="primary">
                {primaryLabel}
                <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
              </Button>
              {isReviewed ? (
                <Button asChild variant="secondary">
                  <Link href={returnHref}>{returnLabel}</Link>
                </Button>
              ) : null}
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
