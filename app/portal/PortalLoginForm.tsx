"use client";

import { FormEvent, useState, useTransition } from "react";
import { Eye, EyeOff, LoaderCircle, LockKeyhole, Mail } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/app/components/ui/button";
import { authClient } from "@/lib/auth-client";

export function PortalLoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);

    startTransition(async () => {
      const { error } = await authClient.signIn.email({
        email,
        password,
        rememberMe: true,
      });

      if (error) {
        setErrorMessage(error.message || "Unable to sign in with that account.");
        return;
      }

      router.replace("/portal/app");
      router.refresh();
    });
  };

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <label className="block">
        <span className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-[#61787b]">
          <Mail className="h-4 w-4 text-accent" aria-hidden="true" />
          Email
        </span>
        <div className="rounded-[1.35rem] border border-[#0f2b31]/8 bg-white/85 shadow-[0_12px_28px_rgba(16,39,44,0.04),inset_0_1px_0_rgba(255,255,255,0.82)] transition focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/15">
          <input
            autoComplete="email"
            className="w-full rounded-[1.35rem] bg-transparent px-4 py-4 text-base text-[#10272c] outline-none placeholder:text-[#90a0a2]"
            name="email"
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@practice.com"
            required
            type="email"
            value={email}
          />
        </div>
      </label>

      <label className="block">
        <span className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-[#61787b]">
          <LockKeyhole className="h-4 w-4 text-accent" aria-hidden="true" />
          Password
        </span>
        <div className="flex rounded-[1.35rem] border border-[#0f2b31]/8 bg-white/85 shadow-[0_12px_28px_rgba(16,39,44,0.04),inset_0_1px_0_rgba(255,255,255,0.82)] transition focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/15">
          <input
            autoComplete="current-password"
            className="min-w-0 flex-1 rounded-l-[1.35rem] bg-transparent px-4 py-4 text-base text-[#10272c] outline-none placeholder:text-[#90a0a2]"
            name="password"
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Enter your password"
            required
            type={showPassword ? "text" : "password"}
            value={password}
          />
          <button
            aria-label={showPassword ? "Hide password" : "Show password"}
            className="inline-flex items-center justify-center px-4 text-[#7d9194] transition hover:text-[#10272c]"
            type="button"
            onClick={() => setShowPassword((current) => !current)}
          >
            {showPassword ? (
              <EyeOff className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Eye className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        </div>
      </label>

      {errorMessage ? (
        <div
          aria-live="polite"
          className="rounded-[1.2rem] border border-[#e7cccc] bg-[#fff6f4] px-4 py-3 text-sm text-[#9b3c3c]"
          role="alert"
        >
          {errorMessage}
        </div>
      ) : null}

      <Button
        className="h-13 w-full rounded-[1.35rem] shadow-[0_18px_30px_rgba(13,115,119,0.18)]"
        size="lg"
        type="submit"
        variant="primary"
        disabled={isPending}
      >
        {isPending ? (
          <>
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
            Signing in
          </>
        ) : (
          "Sign in"
        )}
      </Button>
    </form>
  );
}
