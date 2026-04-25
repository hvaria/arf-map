import { useState } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAuth } from "@/context/AuthContext";
import type { ApiError } from "@/lib/auth";

// ── Validation schema ─────────────────────────────────────────────────────────

const loginSchema = z.object({
  email: z
    .string()
    .min(1, "Email is required.")
    .email("Please enter a valid email address."),
  password: z.string().min(1, "Password is required."),
  rememberMe: z.boolean().optional(),
});

type LoginFormValues = z.infer<typeof loginSchema>;

// ── Sub-components ────────────────────────────────────────────────────────────

function BrandMark() {
  return (
    <div
      className="flex flex-col items-center gap-3 mb-8 -mx-8 -mt-10 px-8 pt-8 pb-6 rounded-t-2xl"
      style={{ background: "linear-gradient(135deg, #EEF2FF, #FFF0F6)" }}
    >
      {/* DO NOT MODIFY - Brand Lock */}
      <div
        className="flex items-center justify-center w-12 h-12 rounded-xl shadow-md"
        style={{ background: "linear-gradient(135deg, #818CF8, #F9A8D4)" }}
        aria-hidden="true"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="w-6 h-6 text-white"
          aria-hidden="true"
        >
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          <path d="M9 12l2 2 4-4" />
        </svg>
      </div>
      <span className="text-sm font-semibold tracking-wide uppercase" style={{ color: "#1E1B4B" }}>
        ARF Care Portal
      </span>
    </div>
  );
}

interface ErrorAlertProps {
  message: string;
  code?: string;
}

function ErrorAlert({ message, code }: ErrorAlertProps) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 dark:border-red-800/40 dark:bg-red-950/30"
    >
      <svg
        viewBox="0 0 20 20"
        fill="currentColor"
        className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500 dark:text-red-400"
        aria-hidden="true"
      >
        <path
          fillRule="evenodd"
          d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z"
          clipRule="evenodd"
        />
      </svg>
      <div className="min-w-0">
        <p className="text-sm font-medium text-red-700 dark:text-red-300">
          {message}
        </p>
        {code === "EMAIL_NOT_VERIFIED" && (
          <p className="mt-1 text-xs text-red-600 dark:text-red-400">
            Check your inbox for the verification email and follow the link, or{" "}
            <a
              href="#/job-seeker"
              className="underline underline-offset-2 hover:text-red-800 dark:hover:text-red-200"
            >
              go to registration
            </a>{" "}
            to resend it.
          </p>
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function LoginPage() {
  const { login } = useAuth();
  const [, setLocation] = useLocation();
  const [serverError, setServerError] = useState<ApiError | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { rememberMe: false },
  });

  const onSubmit = async (values: LoginFormValues) => {
    setServerError(null);
    try {
      await login({
        email: values.email.trim().toLowerCase(),
        password: values.password,
        rememberMe: values.rememberMe,
      });
      setLocation("/jobseeker/dashboard");
    } catch (err) {
      setServerError(err as ApiError);
    }
  };

  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-4 py-12">
      <div className="relative w-full max-w-[420px]">
        {/* Card */}
        <div
          className="rounded-2xl"
          style={{
            background: "#F0F4FF",
            border: "1px solid #E0E7FF",
            boxShadow: "0 2px 12px rgba(129,140,248,0.08)",
          }}
        >
          <div className="px-8 pt-10 pb-8">
            <BrandMark />

            {/* Heading */}
            <div className="mb-7 text-center">
              <h1 className="text-2xl font-semibold tracking-tight" style={{ color: "#1E1B4B" }}>
                Job Seeker Sign In
              </h1>
              <p className="mt-2 text-sm" style={{ color: "#6B7280" }}>
                Access your profile, applications, and job opportunities.
              </p>
            </div>

            {/* Server error alert */}
            {serverError && (
              <div className="mb-5">
                <ErrorAlert
                  message={serverError.message}
                  code={serverError.code}
                />
              </div>
            )}

            {/* Form */}
            <form
              onSubmit={handleSubmit(onSubmit)}
              noValidate
              className="space-y-5"
            >
              {/* Email */}
              <div className="space-y-1.5">
                <label
                  htmlFor="email"
                  className="block text-sm font-medium"
                  style={{ color: "#1E1B4B" }}
                >
                  Email address
                </label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  aria-describedby={errors.email ? "email-error" : undefined}
                  aria-invalid={!!errors.email}
                  placeholder="you@example.com"
                  className="block w-full rounded-lg px-3.5 py-2.5 text-sm outline-none transition-colors shadow-sm focus:ring-2 focus:ring-[#818CF8]/20"
                  style={{
                    border: errors.email ? "1.5px solid #f87171" : "1.5px solid #C7D2FE",
                    background: "#FAFBFF",
                    color: "#1E1B4B",
                  }}
                  {...register("email")}
                />
                {errors.email && (
                  <p
                    id="email-error"
                    role="alert"
                    className="text-xs text-red-600 dark:text-red-400"
                  >
                    {errors.email.message}
                  </p>
                )}
              </div>

              {/* Password */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="password"
                    className="block text-sm font-medium"
                    style={{ color: "#1E1B4B" }}
                  >
                    Password
                  </label>
                  <a
                    href="#/job-seeker?action=forgot-password"
                    className="text-xs underline-offset-2 hover:underline"
                    style={{ color: "#818CF8" }}
                  >
                    Forgot password?
                  </a>
                </div>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    aria-describedby={errors.password ? "password-error" : undefined}
                    aria-invalid={!!errors.password}
                    placeholder="••••••••"
                    className="block w-full rounded-lg px-3.5 py-2.5 pr-10 text-sm outline-none transition-colors shadow-sm focus:ring-2 focus:ring-[#818CF8]/20"
                    style={{
                      border: errors.password ? "1.5px solid #f87171" : "1.5px solid #C7D2FE",
                      background: "#FAFBFF",
                      color: "#1E1B4B",
                    }}
                    {...register("password")}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
                  >
                    {showPassword ? (
                      <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4" aria-hidden="true">
                        <path fillRule="evenodd" d="M3.28 2.22a.75.75 0 00-1.06 1.06l14.5 14.5a.75.75 0 101.06-1.06l-1.745-1.745a10.029 10.029 0 003.3-4.38 1.651 1.651 0 000-1.185A10.004 10.004 0 009.999 3a9.956 9.956 0 00-4.744 1.194L3.28 2.22zM7.752 6.69l1.092 1.092a2.5 2.5 0 013.374 3.373l1.091 1.092a4 4 0 00-5.557-5.557z" clipRule="evenodd" />
                        <path d="M10.748 13.93l2.523 2.523a9.987 9.987 0 01-3.27.547c-4.258 0-7.894-2.66-9.337-6.41a1.651 1.651 0 010-1.186A10.007 10.007 0 012.839 6.02L6.07 9.252a4 4 0 004.678 4.678z" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4" aria-hidden="true">
                        <path d="M10 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" />
                        <path fillRule="evenodd" d="M.664 10.59a1.651 1.651 0 010-1.186A10.004 10.004 0 0110 3c4.257 0 7.893 2.66 9.336 6.41.147.381.146.804 0 1.186A10.004 10.004 0 0110 17c-4.257 0-7.893-2.66-9.336-6.41z" clipRule="evenodd" />
                      </svg>
                    )}
                  </button>
                </div>
                {errors.password && (
                  <p
                    id="password-error"
                    role="alert"
                    className="text-xs text-red-600 dark:text-red-400"
                  >
                    {errors.password.message}
                  </p>
                )}
              </div>

              {/* Remember me */}
              <div className="flex items-center gap-2.5">
                <input
                  id="rememberMe"
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300 text-blue-600 accent-blue-600 focus:ring-2 focus:ring-blue-500/30 dark:border-slate-600"
                  {...register("rememberMe")}
                />
                <label
                  htmlFor="rememberMe"
                  className="text-sm text-slate-600 dark:text-slate-400 select-none cursor-pointer"
                >
                  Remember me for 30 days
                </label>
              </div>

              {/* Submit */}
              <button
                type="submit"
                disabled={isSubmitting}
                aria-busy={isSubmitting}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-[#818CF8] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                style={{
                  background: "linear-gradient(135deg, #818CF8, #F9A8D4)",
                  borderRadius: "10px",
                }}
              >
                {isSubmitting ? (
                  <>
                    <svg
                      className="h-4 w-4 animate-spin"
                      viewBox="0 0 24 24"
                      fill="none"
                      aria-hidden="true"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                      />
                    </svg>
                    Signing in…
                  </>
                ) : (
                  "Sign in"
                )}
              </button>
            </form>
          </div>

          {/* Divider footer */}
          <div className="border-t border-slate-100 dark:border-slate-800 px-8 py-5">
            <p className="text-center text-sm text-slate-500 dark:text-slate-400">
              Don&rsquo;t have an account?{" "}
              <a
                href="#/job-seeker"
                className="font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 underline-offset-2 hover:underline"
              >
                Create an account
              </a>
            </p>
          </div>
        </div>

        {/* Footer note */}
        <p className="mt-6 text-center text-xs text-slate-400 dark:text-slate-600">
          By signing in you agree to our{" "}
          <a href="#" className="underline underline-offset-2 hover:text-slate-500">
            Terms of Service
          </a>{" "}
          and{" "}
          <a href="#" className="underline underline-offset-2 hover:text-slate-500">
            Privacy Policy
          </a>
          .
        </p>
      </div>
    </div>
  );
}
