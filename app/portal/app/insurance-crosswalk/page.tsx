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
import { saveInsuranceCrosswalkAction } from "../actions";

export default async function PortalInsuranceCrosswalkPage() {
  const portalState = await getPortalWorkspaceState();
  const isReviewed = portalState.sections.find(
    (section) => section.key === "insuranceCrosswalk"
  )?.complete;
  const primaryLabel = portalState.launched ? "Save changes" : "Save and continue";
  const returnHref = portalState.launched ? "/portal/app/overview" : "/portal/app/onboarding";
  const returnLabel = portalState.launched ? "Back to overview" : "Back to onboarding";

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <p className="text-sm font-medium uppercase tracking-[0.16em] text-[#6a7b7e]">
          Insurance Crosswalk
        </p>
        <h2 className="text-3xl font-semibold tracking-[-0.05em] text-[#10272c]">
          Insurance rules
        </h2>
        <p className="max-w-2xl text-base leading-relaxed text-[#617477]">
          Keep this structured. The goal is quick coverage guidance and clear staff handoffs.
        </p>
      </section>

      <Card className="rounded-[1.8rem] border-black/6 bg-white">
        <CardHeader>
          <CardTitle>{isReviewed ? "Insurance saved" : "Finish this step"}</CardTitle>
          <CardDescription>Accepted plans, exceptions, and transfer rules.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={saveInsuranceCrosswalkAction} className="grid gap-4">
            <PortalTextareaField
              defaultValue={portalState.draft.insuranceAcceptedPlans}
              label="Accepted plans"
              name="insuranceAcceptedPlans"
              placeholder="Aetna, Blue Cross Blue Shield, Medicare, VSP"
              rows={3}
            />
            <PortalTextareaField
              defaultValue={portalState.draft.insuranceExceptions}
              label="Exceptions"
              name="insuranceExceptions"
              placeholder="No Medicaid at surgery center. Vision plans only at main office."
              rows={3}
            />
            <PortalTextareaField
              defaultValue={portalState.draft.insuranceTransferRules}
              label="Transfer to staff when"
              name="insuranceTransferRules"
              placeholder="Coverage is unclear, plan is not listed, or referral authorization is required."
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
