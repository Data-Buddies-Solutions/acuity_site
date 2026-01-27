"use client";

import { useState, useEffect, useRef } from "react";
import { Phone, Calendar, MessageSquare, Check, FileText, ScanSearch, Database, Send, ShieldCheck, ClipboardList, Upload, BadgeCheck } from "lucide-react";

// Scheduling steps
const schedulingSteps = [
  { icon: Phone, label: "Call" },
  { icon: MessageSquare, label: "Chat" },
  { icon: Calendar, label: "Book" },
  { icon: Check, label: "Done" },
];

// Referral steps
const referralSteps = [
  { icon: FileText, label: "Fax" },
  { icon: ScanSearch, label: "Scan" },
  { icon: Database, label: "Store" },
  { icon: Send, label: "Outreach" },
];

// Pre-Auth steps
const preAuthSteps = [
  { icon: ClipboardList, label: "Request" },
  { icon: ScanSearch, label: "Verify" },
  { icon: Upload, label: "Submit" },
  { icon: BadgeCheck, label: "Approved" },
];

function SchedulingAnimation({ isVisible }: { isVisible: boolean }) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!isVisible) return;
    const timer = setInterval(() => {
      setStep((prev) => (prev + 1) % 4);
    }, 6000);
    return () => clearInterval(timer);
  }, [isVisible]);

  return (
    <div className="relative w-full overflow-hidden">
      {/* Step indicators */}
      <div className="flex items-center justify-between mb-6 md:mb-8 px-0 md:px-4 max-w-sm md:max-w-md mx-auto">
        {schedulingSteps.map((s, i) => {
          const Icon = s.icon;
          const isActive = step === i;
          const isPast = step > i;
          return (
            <div key={i} className="flex items-center">
              <button
                onClick={() => setStep(i)}
                className={`relative flex flex-col items-center gap-1 md:gap-1.5 transition-all duration-500 ${
                  isActive ? "scale-105 md:scale-110" : "scale-100"
                }`}
              >
                <div
                  className={`w-9 h-9 md:w-11 md:h-11 rounded-full flex items-center justify-center transition-all duration-500 ${
                    isActive
                      ? "bg-neutral-900 shadow-lg shadow-neutral-900/25"
                      : isPast
                      ? "bg-neutral-900"
                      : "bg-neutral-100 border-2 border-neutral-200"
                  }`}
                >
                  <Icon
                    className={`w-4 h-4 md:w-5 md:h-5 transition-colors duration-300 ${
                      isActive || isPast ? "text-white" : "text-neutral-400"
                    }`}
                  />
                </div>
                <span
                  className={`text-[9px] md:text-[11px] font-semibold uppercase tracking-wide transition-colors duration-300 ${
                    isActive ? "text-neutral-900" : "text-neutral-400"
                  }`}
                >
                  {s.label}
                </span>
              </button>
              {i < 3 && (
                <div
                  className={`w-4 md:w-12 h-0.5 mx-0.5 md:mx-2 transition-colors duration-500 ${
                    isPast ? "bg-neutral-900" : "bg-neutral-200"
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Animation content */}
      <div className="relative h-[220px] md:h-[260px] flex items-center justify-center overflow-hidden">
        {/* Step 0: Phone ringing */}
        <div
          className={`absolute inset-0 flex items-center justify-center transition-all duration-700 ${
            step === 0
              ? "opacity-100 scale-100 translate-y-0"
              : "opacity-0 scale-95 translate-y-4 pointer-events-none"
          }`}
        >
          <div className="flex flex-col items-center">
            <div className="relative">
              <div className="absolute inset-0 -m-4 rounded-full border-2 border-neutral-300 animate-ping opacity-75" style={{ animationDuration: '1.5s' }} />
              <div className="absolute inset-0 -m-8 rounded-full border border-neutral-200 animate-ping opacity-50" style={{ animationDuration: '2s' }} />
              <div className="w-24 h-24 md:w-28 md:h-28 rounded-full bg-neutral-200 flex items-center justify-center shadow-xl shadow-neutral-900/10">
                <Phone className="w-10 h-10 md:w-12 md:h-12 text-neutral-900" />
              </div>
            </div>
            <p className="mt-5 text-base text-neutral-600 font-medium">Incoming call...</p>
          </div>
        </div>

        {/* Step 1: Conversation */}
        <div
          className={`absolute inset-0 flex items-center justify-center transition-all duration-700 ${
            step === 1
              ? "opacity-100 scale-100 translate-y-0"
              : "opacity-0 scale-95 translate-y-4 pointer-events-none"
          }`}
        >
          <div className="flex flex-col gap-3 w-full max-w-sm px-4">
            <div className="self-start">
              <div className="bg-neutral-100 rounded-2xl rounded-bl-sm px-4 py-3">
                <p className="text-sm md:text-base text-neutral-700">"I need to schedule an eye exam"</p>
              </div>
            </div>
            <div className="self-end">
              <div className="bg-neutral-900 rounded-2xl rounded-br-sm px-4 py-3 shadow-lg">
                <p className="text-sm md:text-base text-white">"Tuesday 2pm or Thursday 10am?"</p>
              </div>
            </div>
            <div className="self-start">
              <div className="bg-neutral-100 rounded-2xl rounded-bl-sm px-4 py-3">
                <p className="text-sm md:text-base text-neutral-700">"Tuesday works!"</p>
              </div>
            </div>
          </div>
        </div>

        {/* Step 2: Calendar selection */}
        <div
          className={`absolute inset-0 flex items-center justify-center transition-all duration-700 ${
            step === 2
              ? "opacity-100 scale-100 translate-y-0"
              : "opacity-0 scale-95 translate-y-4 pointer-events-none"
          }`}
        >
          <div className="bg-white rounded-2xl p-6 shadow-xl shadow-neutral-900/10 border border-neutral-100">
            <div className="flex items-center gap-2 mb-3">
              <Calendar className="w-5 h-5 text-neutral-500" />
              <span className="text-sm font-medium text-neutral-500">Booked</span>
            </div>
            <div className="text-4xl md:text-5xl font-semibold text-neutral-900 tracking-tight">2:00 PM</div>
            <div className="text-base text-neutral-500 mt-1">Tue • Dr. Chen • Eye Exam</div>
          </div>
        </div>

        {/* Step 3: Confirmed */}
        <div
          className={`absolute inset-0 flex items-center justify-center transition-all duration-700 ${
            step === 3
              ? "opacity-100 scale-100 translate-y-0"
              : "opacity-0 scale-95 translate-y-4 pointer-events-none"
          }`}
        >
          <div className="flex flex-col items-center">
            <div className="w-24 h-24 md:w-28 md:h-28 rounded-full bg-emerald-500 flex items-center justify-center shadow-xl shadow-emerald-500/30">
              <Check className="w-12 h-12 md:w-14 md:h-14 text-white" strokeWidth={3} />
            </div>
            <p className="mt-5 text-xl md:text-2xl font-semibold text-neutral-900">Confirmed</p>
            <p className="text-sm text-neutral-500 mt-1">SMS sent • Synced to EHR</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function ReferralAnimation({ isVisible }: { isVisible: boolean }) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!isVisible) return;
    const timer = setInterval(() => {
      setStep((prev) => (prev + 1) % 4);
    }, 6000);
    return () => clearInterval(timer);
  }, [isVisible]);

  return (
    <div className="relative w-full overflow-hidden">
      {/* Step indicators */}
      <div className="flex items-center justify-between mb-6 md:mb-8 px-0 md:px-4 max-w-sm md:max-w-md mx-auto">
        {referralSteps.map((s, i) => {
          const Icon = s.icon;
          const isActive = step === i;
          const isPast = step > i;
          return (
            <div key={i} className="flex items-center">
              <button
                onClick={() => setStep(i)}
                className={`relative flex flex-col items-center gap-1 md:gap-1.5 transition-all duration-500 ${
                  isActive ? "scale-105 md:scale-110" : "scale-100"
                }`}
              >
                <div
                  className={`w-9 h-9 md:w-11 md:h-11 rounded-full flex items-center justify-center transition-all duration-500 ${
                    isActive
                      ? "bg-neutral-900 shadow-lg shadow-neutral-900/25"
                      : isPast
                      ? "bg-neutral-900"
                      : "bg-neutral-100 border-2 border-neutral-200"
                  }`}
                >
                  <Icon
                    className={`w-4 h-4 md:w-5 md:h-5 transition-colors duration-300 ${
                      isActive || isPast ? "text-white" : "text-neutral-400"
                    }`}
                  />
                </div>
                <span
                  className={`text-[9px] md:text-[11px] font-semibold uppercase tracking-wide transition-colors duration-300 ${
                    isActive ? "text-neutral-900" : "text-neutral-400"
                  }`}
                >
                  {s.label}
                </span>
              </button>
              {i < 3 && (
                <div
                  className={`w-4 md:w-12 h-0.5 mx-0.5 md:mx-2 transition-colors duration-500 ${
                    isPast ? "bg-neutral-900" : "bg-neutral-200"
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Animation content */}
      <div className="relative h-[220px] md:h-[260px] flex items-center justify-center overflow-hidden">
        {/* Step 0: Fax received */}
        <div
          className={`absolute inset-0 flex items-center justify-center transition-all duration-700 ${
            step === 0
              ? "opacity-100 scale-100 translate-y-0"
              : "opacity-0 scale-95 translate-y-4 pointer-events-none"
          }`}
        >
          <div className="flex flex-col items-center">
            <div className="relative">
              <div className="absolute inset-0 -m-4 rounded-full border-2 border-neutral-300 animate-ping opacity-75" style={{ animationDuration: '1.5s' }} />
              <div className="absolute inset-0 -m-8 rounded-full border border-neutral-200 animate-ping opacity-50" style={{ animationDuration: '2s' }} />
              <div className="w-24 h-24 md:w-28 md:h-28 rounded-full bg-neutral-200 flex items-center justify-center shadow-xl shadow-neutral-900/10">
                <FileText className="w-10 h-10 md:w-12 md:h-12 text-neutral-900" />
              </div>
            </div>
            <p className="mt-5 text-base text-neutral-600 font-medium">Referral fax received</p>
          </div>
        </div>

        {/* Step 1: Scanning info */}
        <div
          className={`absolute inset-0 flex items-center justify-center transition-all duration-700 ${
            step === 1
              ? "opacity-100 scale-100 translate-y-0"
              : "opacity-0 scale-95 translate-y-4 pointer-events-none"
          }`}
        >
          <div className="flex flex-col items-center px-2">
            <div className="bg-white rounded-2xl p-4 md:p-6 shadow-xl shadow-neutral-900/10 border border-neutral-100">
              <div className="flex items-center gap-2 md:gap-3 mb-3 md:mb-4">
                <ScanSearch className="w-5 h-5 md:w-6 md:h-6 text-neutral-900" />
                <span className="text-xs md:text-sm font-semibold text-neutral-900">Extracting data...</span>
              </div>
              <div className="space-y-2 md:space-y-2.5">
                <div className="flex items-center gap-2 md:gap-3">
                  <Check className="w-3.5 h-3.5 md:w-4 md:h-4 text-emerald-500 flex-shrink-0" />
                  <span className="text-xs md:text-sm text-neutral-600">Patient: Sarah Johnson</span>
                </div>
                <div className="flex items-center gap-2 md:gap-3">
                  <Check className="w-3.5 h-3.5 md:w-4 md:h-4 text-emerald-500 flex-shrink-0" />
                  <span className="text-xs md:text-sm text-neutral-600">DOB: 03/15/1985</span>
                </div>
                <div className="flex items-center gap-2 md:gap-3">
                  <Check className="w-3.5 h-3.5 md:w-4 md:h-4 text-emerald-500 flex-shrink-0" />
                  <span className="text-xs md:text-sm text-neutral-600">Referring: Dr. Smith</span>
                </div>
                <div className="flex items-center gap-2 md:gap-3">
                  <div className="w-3.5 h-3.5 md:w-4 md:h-4 border-2 border-neutral-300 rounded-full animate-spin border-t-neutral-900 flex-shrink-0" />
                  <span className="text-xs md:text-sm text-neutral-400">Diagnosis code...</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Step 2: Database entry */}
        <div
          className={`absolute inset-0 flex items-center justify-center transition-all duration-700 ${
            step === 2
              ? "opacity-100 scale-100 translate-y-0"
              : "opacity-0 scale-95 translate-y-4 pointer-events-none"
          }`}
        >
          <div className="flex flex-col items-center px-2">
            <div className="bg-white rounded-2xl p-4 md:p-5 shadow-xl shadow-neutral-900/10 border border-neutral-100">
              <div className="flex items-center gap-2 mb-3 md:mb-4">
                <Database className="w-4 h-4 md:w-5 md:h-5 text-neutral-500" />
                <span className="text-xs md:text-sm font-medium text-neutral-500">Added to system</span>
              </div>
              {/* Mini spreadsheet look */}
              <div className="border border-neutral-200 rounded-lg overflow-hidden">
                <div className="grid grid-cols-3 text-[9px] md:text-[11px] font-semibold text-neutral-500 bg-neutral-50">
                  <div className="px-2 md:px-3 py-1.5 md:py-2 border-r border-neutral-200">Name</div>
                  <div className="px-2 md:px-3 py-1.5 md:py-2 border-r border-neutral-200">Phone</div>
                  <div className="px-2 md:px-3 py-1.5 md:py-2">Status</div>
                </div>
                <div className="grid grid-cols-3 text-xs md:text-sm bg-emerald-50 text-neutral-700">
                  <div className="px-2 md:px-3 py-1.5 md:py-2 border-r border-t border-neutral-200 font-medium">S. Johnson</div>
                  <div className="px-2 md:px-3 py-1.5 md:py-2 border-r border-t border-neutral-200">(555) 0123</div>
                  <div className="px-2 md:px-3 py-1.5 md:py-2 border-t border-neutral-200">
                    <span className="text-[10px] md:text-xs px-1.5 md:px-2 py-0.5 bg-emerald-500 text-white rounded-full">New</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Step 3: Patient outreach */}
        <div
          className={`absolute inset-0 flex items-center justify-center transition-all duration-700 ${
            step === 3
              ? "opacity-100 scale-100 translate-y-0"
              : "opacity-0 scale-95 translate-y-4 pointer-events-none"
          }`}
        >
          <div className="flex flex-col items-center">
            <div className="w-24 h-24 md:w-28 md:h-28 rounded-full bg-emerald-500 flex items-center justify-center shadow-xl shadow-emerald-500/30">
              <Send className="w-10 h-10 md:w-12 md:h-12 text-white" />
            </div>
            <p className="mt-5 text-xl md:text-2xl font-semibold text-neutral-900">Patient Contacted</p>
            <p className="text-sm text-neutral-500 mt-1">SMS & call scheduled</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function PreAuthAnimation({ isVisible }: { isVisible: boolean }) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!isVisible) return;
    const timer = setInterval(() => {
      setStep((prev) => (prev + 1) % 4);
    }, 6000);
    return () => clearInterval(timer);
  }, [isVisible]);

  return (
    <div className="relative w-full overflow-hidden">
      {/* Step indicators */}
      <div className="flex items-center justify-between mb-6 md:mb-8 px-0 md:px-4 max-w-sm md:max-w-md mx-auto">
        {preAuthSteps.map((s, i) => {
          const Icon = s.icon;
          const isActive = step === i;
          const isPast = step > i;
          return (
            <div key={i} className="flex items-center">
              <button
                onClick={() => setStep(i)}
                className={`relative flex flex-col items-center gap-1 md:gap-1.5 transition-all duration-500 ${
                  isActive ? "scale-105 md:scale-110" : "scale-100"
                }`}
              >
                <div
                  className={`w-9 h-9 md:w-11 md:h-11 rounded-full flex items-center justify-center transition-all duration-500 ${
                    isActive
                      ? "bg-neutral-900 shadow-lg shadow-neutral-900/25"
                      : isPast
                      ? "bg-neutral-900"
                      : "bg-neutral-100 border-2 border-neutral-200"
                  }`}
                >
                  <Icon
                    className={`w-4 h-4 md:w-5 md:h-5 transition-colors duration-300 ${
                      isActive || isPast ? "text-white" : "text-neutral-400"
                    }`}
                  />
                </div>
                <span
                  className={`text-[9px] md:text-[11px] font-semibold uppercase tracking-wide transition-colors duration-300 ${
                    isActive ? "text-neutral-900" : "text-neutral-400"
                  }`}
                >
                  {s.label}
                </span>
              </button>
              {i < 3 && (
                <div
                  className={`w-4 md:w-12 h-0.5 mx-0.5 md:mx-2 transition-colors duration-500 ${
                    isPast ? "bg-neutral-900" : "bg-neutral-200"
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Animation content */}
      <div className="relative h-[220px] md:h-[260px] flex items-center justify-center overflow-hidden">
        {/* Step 0: Request received */}
        <div
          className={`absolute inset-0 flex items-center justify-center transition-all duration-700 ${
            step === 0
              ? "opacity-100 scale-100 translate-y-0"
              : "opacity-0 scale-95 translate-y-4 pointer-events-none"
          }`}
        >
          <div className="flex flex-col items-center">
            <div className="relative">
              <div className="absolute inset-0 -m-4 rounded-full border-2 border-neutral-300 animate-ping opacity-75" style={{ animationDuration: '1.5s' }} />
              <div className="absolute inset-0 -m-8 rounded-full border border-neutral-200 animate-ping opacity-50" style={{ animationDuration: '2s' }} />
              <div className="w-24 h-24 md:w-28 md:h-28 rounded-full bg-neutral-200 flex items-center justify-center shadow-xl shadow-neutral-900/10">
                <ClipboardList className="w-10 h-10 md:w-12 md:h-12 text-neutral-900" />
              </div>
            </div>
            <p className="mt-5 text-base text-neutral-600 font-medium">Pre-auth request received</p>
          </div>
        </div>

        {/* Step 1: Verifying eligibility */}
        <div
          className={`absolute inset-0 flex items-center justify-center transition-all duration-700 ${
            step === 1
              ? "opacity-100 scale-100 translate-y-0"
              : "opacity-0 scale-95 translate-y-4 pointer-events-none"
          }`}
        >
          <div className="flex flex-col items-center px-2">
            <div className="bg-white rounded-2xl p-4 md:p-6 shadow-xl shadow-neutral-900/10 border border-neutral-100">
              <div className="flex items-center gap-2 md:gap-3 mb-3 md:mb-4">
                <ScanSearch className="w-5 h-5 md:w-6 md:h-6 text-neutral-900" />
                <span className="text-xs md:text-sm font-semibold text-neutral-900">Verifying eligibility...</span>
              </div>
              <div className="space-y-2 md:space-y-2.5">
                <div className="flex items-center gap-2 md:gap-3">
                  <Check className="w-3.5 h-3.5 md:w-4 md:h-4 text-emerald-500 flex-shrink-0" />
                  <span className="text-xs md:text-sm text-neutral-600">Patient: Michael Chen</span>
                </div>
                <div className="flex items-center gap-2 md:gap-3">
                  <Check className="w-3.5 h-3.5 md:w-4 md:h-4 text-emerald-500 flex-shrink-0" />
                  <span className="text-xs md:text-sm text-neutral-600">Insurance: Blue Cross</span>
                </div>
                <div className="flex items-center gap-2 md:gap-3">
                  <Check className="w-3.5 h-3.5 md:w-4 md:h-4 text-emerald-500 flex-shrink-0" />
                  <span className="text-xs md:text-sm text-neutral-600">Procedure: Cataract Surgery</span>
                </div>
                <div className="flex items-center gap-2 md:gap-3">
                  <div className="w-3.5 h-3.5 md:w-4 md:h-4 border-2 border-neutral-300 rounded-full animate-spin border-t-neutral-900 flex-shrink-0" />
                  <span className="text-xs md:text-sm text-neutral-400">Checking coverage...</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Step 2: Submitting to payer */}
        <div
          className={`absolute inset-0 flex items-center justify-center transition-all duration-700 ${
            step === 2
              ? "opacity-100 scale-100 translate-y-0"
              : "opacity-0 scale-95 translate-y-4 pointer-events-none"
          }`}
        >
          <div className="flex flex-col items-center px-2">
            <div className="bg-white rounded-2xl p-4 md:p-5 shadow-xl shadow-neutral-900/10 border border-neutral-100">
              <div className="flex items-center gap-2 mb-3 md:mb-4">
                <Upload className="w-4 h-4 md:w-5 md:h-5 text-neutral-500" />
                <span className="text-xs md:text-sm font-medium text-neutral-500">Submitting to payer</span>
              </div>
              {/* Progress indicator */}
              <div className="w-48 md:w-64 space-y-2 md:space-y-3">
                <div className="flex items-center justify-between text-xs md:text-sm">
                  <span className="text-neutral-600">Blue Cross Portal</span>
                  <span className="text-emerald-600 font-medium">Uploading...</span>
                </div>
                <div className="h-1.5 md:h-2 bg-neutral-100 rounded-full overflow-hidden">
                  <div className="h-full bg-neutral-900 rounded-full animate-pulse" style={{ width: '75%' }} />
                </div>
                <div className="flex items-center gap-2 text-[10px] md:text-xs text-neutral-500">
                  <Check className="w-3 h-3 text-emerald-500" />
                  <span>Clinical notes attached</span>
                </div>
                <div className="flex items-center gap-2 text-[10px] md:text-xs text-neutral-500">
                  <Check className="w-3 h-3 text-emerald-500" />
                  <span>CPT codes verified</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Step 3: Approved */}
        <div
          className={`absolute inset-0 flex items-center justify-center transition-all duration-700 ${
            step === 3
              ? "opacity-100 scale-100 translate-y-0"
              : "opacity-0 scale-95 translate-y-4 pointer-events-none"
          }`}
        >
          <div className="flex flex-col items-center">
            <div className="w-24 h-24 md:w-28 md:h-28 rounded-full bg-emerald-500 flex items-center justify-center shadow-xl shadow-emerald-500/30">
              <BadgeCheck className="w-12 h-12 md:w-14 md:h-14 text-white" />
            </div>
            <p className="mt-5 text-xl md:text-2xl font-semibold text-neutral-900">Approved</p>
            <p className="text-sm text-neutral-500 mt-1">Auth #PA-847291 • Valid 90 days</p>
          </div>
        </div>
      </div>
    </div>
  );
}

const solutions = [
  {
    id: "scheduling",
    icon: Phone,
    label: "Scheduling",
    component: SchedulingAnimation,
    stats: [
      { value: "24/7", label: "Availability" },
      { value: "30", label: "Concurrent calls" },
      { value: "Zero", label: "Dropped calls" },
    ],
  },
  {
    id: "referrals",
    icon: FileText,
    label: "Referrals",
    component: ReferralAnimation,
    stats: [
      { value: "100%", label: "Capture rate" },
      { value: "<30s", label: "Processing time" },
      { value: "Same day", label: "Outreach" },
    ],
  },
  {
    id: "preauth",
    icon: ShieldCheck,
    label: "Pre-Auth",
    component: PreAuthAnimation,
    stats: [
      { value: "95%", label: "Approval rate" },
      { value: "100%", label: "Auto-submitted" },
      { value: "Zero", label: "Manual entry" },
    ],
  },
];

export default function WhatWeBuild() {
  const [activeTab, setActiveTab] = useState(0);
  const [isVisible, setIsVisible] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);
  const activeSolution = solutions[activeTab];
  const ActiveComponent = activeSolution.component;

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
        }
      },
      { threshold: 0.3 }
    );

    if (sectionRef.current) {
      observer.observe(sectionRef.current);
    }

    return () => observer.disconnect();
  }, []);

  return (
    <section ref={sectionRef} className="py-16 md:py-24 bg-white" id="what-we-build">
      <div className="mx-auto max-w-4xl px-4 md:px-6">
        {/* Section header */}
        <div className="text-center mb-10 md:mb-14">
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-semibold tracking-tight mb-3 md:mb-4">
            What We Build
          </h2>
          <p className="text-sm md:text-base text-neutral-500 max-w-lg mx-auto">
            AI-powered solutions that automate your admin tasks
          </p>
        </div>

        {/* Tab buttons - Stack AI style */}
        <div className="flex justify-center gap-3 md:gap-12 lg:gap-20 mb-8 md:mb-12">
          {solutions.map((solution, index) => {
            const Icon = solution.icon;
            const isActive = activeTab === index;
            return (
              <button
                key={solution.id}
                onClick={() => setActiveTab(index)}
                className={`relative flex flex-col items-center gap-2 md:gap-3 px-3 py-3 md:px-6 md:py-4 rounded-xl md:rounded-2xl transition-all duration-300 ${
                  isActive
                    ? "bg-neutral-100"
                    : "hover:bg-neutral-50"
                }`}
              >
                {/* Active indicator line */}
                {isActive && (
                  <div className="absolute top-1.5 md:top-2 left-1/2 -translate-x-1/2 w-6 md:w-8 h-0.5 md:h-1 bg-neutral-900 rounded-full" />
                )}
                <div className={`w-10 h-10 md:w-14 md:h-14 rounded-lg md:rounded-xl flex items-center justify-center transition-all duration-300 ${
                  isActive ? "bg-neutral-900" : "bg-neutral-100"
                }`}>
                  <Icon className={`w-5 h-5 md:w-6 md:h-6 ${isActive ? "text-white" : "text-neutral-900"}`} />
                </div>
                <span className={`text-xs md:text-sm font-semibold transition-colors ${isActive ? "text-neutral-900" : "text-neutral-500"}`}>{solution.label}</span>
              </button>
            );
          })}
        </div>

        {/* Animation container - elevated card */}
        <div className="bg-white rounded-2xl md:rounded-[2rem] p-4 md:p-10 shadow-2xl shadow-neutral-900/10 border border-neutral-100 mb-8 md:mb-10">
          <ActiveComponent key={activeTab} isVisible={isVisible} />
        </div>

        {/* Stats */}
        <div className="flex justify-center gap-6 md:gap-20">
          {activeSolution.stats.map((stat, index) => (
            <div key={index} className="text-center">
              <p className="text-xl md:text-3xl font-semibold text-neutral-900">{stat.value}</p>
              <p className="text-[10px] md:text-sm text-neutral-500 mt-0.5">{stat.label}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
