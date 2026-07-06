"use client";

import { FormEvent, useState, useTransition } from "react";
import { Eye, EyeOff, LoaderCircle, LockKeyhole, Mail } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

export function PortalLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);

    startTransition(async () => {
      const rawLogin = email.trim();
      const loginEmail =
        rawLogin.toLowerCase() === "admin" ? "admin@acuityhealth.io" : rawLogin;
      const isAdminLogin = loginEmail.toLowerCase() === "admin@acuityhealth.io";

      const { error } = await authClient.signIn.email({
        email: loginEmail,
        password,
        rememberMe: true,
      });

      if (error) {
        setErrorMessage(error.message || "Unable to sign in with that account.");
        return;
      }

      const nextPath = searchParams.get("next");
      const safeNextPath =
        nextPath?.startsWith("/") &&
        !nextPath.startsWith("//") &&
        !nextPath.startsWith("/portal/app/onboarding")
          ? nextPath
          : isAdminLogin
            ? "/admin/practices"
            : "/portal/app";

      router.replace(safeNextPath);
      router.refresh();
    });
  };

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <label className="block">
        <span className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-[#667085]">
          <Mail className="h-4 w-4 text-accent" aria-hidden="true" />
          Email or username
        </span>
        <div className="rounded-xl border border-[#d8dde8] bg-white/90 shadow-[0_12px_28px_rgba(25,32,58,0.04),inset_0_1px_0_rgba(255,255,255,0.82)] transition focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/15">
          <input
            autoCapitalize="none"
            autoComplete="username"
            className="w-full rounded-xl bg-transparent px-4 py-4 text-base text-[#19203a] outline-none placeholder:text-[#8a94a6]"
            name="email"
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@practice.com or admin"
            required
            spellCheck={false}
            type="text"
            value={email}
          />
        </div>
      </label>

      <label className="block">
        <span className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-[#667085]">
          <LockKeyhole className="h-4 w-4 text-accent" aria-hidden="true" />
          Password
        </span>
        <div className="flex rounded-xl border border-[#d8dde8] bg-white/90 shadow-[0_12px_28px_rgba(25,32,58,0.04),inset_0_1px_0_rgba(255,255,255,0.82)] transition focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/15">
          <input
            autoComplete="current-password"
            className="min-w-0 flex-1 rounded-l-xl bg-transparent px-4 py-4 text-base text-[#19203a] outline-none placeholder:text-[#8a94a6]"
            name="password"
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Enter your password"
            required
            type={showPassword ? "text" : "password"}
            value={password}
          />
          <button
            aria-label={showPassword ? "Hide password" : "Show password"}
            className="inline-flex items-center justify-center px-4 text-[#8a94a6] transition hover:text-[#19203a]"
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
        className="h-13 w-full rounded-xl shadow-[0_18px_30px_rgba(83,106,145,0.18)]"
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
