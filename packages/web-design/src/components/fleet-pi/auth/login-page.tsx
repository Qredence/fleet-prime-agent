import { useId } from "react"
import { Button } from "../../button"
import { Field, FieldError, FieldGroup, FieldLabel } from "../../field"
import { Input } from "../../input"
import { Separator } from "../../separator"
import { Spinner } from "../../spinner"
import { GoogleIcon } from "../icons/google-icon"
import { CenteredLoader } from "../primitives/centered-loader"
import type { FormEvent } from "react"

export type LoginPageProps = {
  mode: "signin" | "signup"
  email: string
  password: string
  name: string
  loading: boolean
  error: string | null
  title: string
  subtitle: string
  continueWithoutAuthLabel?: string
  toggleModeLabel: string
  submitLabel: string
  loadingLabel: string
  googleButtonLabel: string
  onModeChange: (mode: "signin" | "signup") => void
  onEmailChange: (value: string) => void
  onPasswordChange: (value: string) => void
  onNameChange: (value: string) => void
  onEmailSubmit: (event: FormEvent) => void
  onGoogleSignIn: () => void
  onContinueWithoutAuth?: () => void
}

export type LoginPageLoadingProps = {
  className?: string
}

export function LoginPageLoading({ className }: LoginPageLoadingProps) {
  return <CenteredLoader className={className} />
}

export function LoginPage({
  mode,
  email,
  password,
  name,
  loading,
  error,
  title,
  subtitle,
  continueWithoutAuthLabel = "Continue without signing in",
  toggleModeLabel,
  submitLabel,
  loadingLabel,
  googleButtonLabel,
  onModeChange,
  onEmailChange,
  onPasswordChange,
  onNameChange,
  onEmailSubmit,
  onGoogleSignIn,
  onContinueWithoutAuth,
}: LoginPageProps) {
  const nameId = useId()
  const emailId = useId()
  const passwordId = useId()
  const formErrorId = useId()

  return (
    <div className="flex min-h-svh items-center justify-center bg-background px-4">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex flex-col gap-1 text-center">
          <h1 className="text-lg font-semibold text-foreground">{title}</h1>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>

        <form
          onSubmit={onEmailSubmit}
          aria-describedby={error ? formErrorId : undefined}
        >
          <FieldGroup className="gap-3">
            {mode === "signup" ? (
              <Field>
                <FieldLabel htmlFor={nameId}>Name</FieldLabel>
                <Input
                  id={nameId}
                  type="text"
                  placeholder="Name"
                  value={name}
                  onChange={(e) => onNameChange(e.target.value)}
                  autoComplete="name"
                />
              </Field>
            ) : null}
            <Field>
              <FieldLabel htmlFor={emailId}>Email</FieldLabel>
              <Input
                id={emailId}
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => onEmailChange(e.target.value)}
                required
                autoComplete="email"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={passwordId}>Password</FieldLabel>
              <Input
                id={passwordId}
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => onPasswordChange(e.target.value)}
                required
                minLength={8}
                autoComplete={
                  mode === "signup" ? "new-password" : "current-password"
                }
              />
            </Field>

            {error ? (
              <FieldError id={formErrorId} role="alert">
                {error}
              </FieldError>
            ) : null}

            <Button
              type="submit"
              className="w-full"
              size="lg"
              disabled={loading}
            >
              {loading ? <Spinner data-icon="inline-start" /> : null}
              {loading ? loadingLabel : submitLabel}
            </Button>
          </FieldGroup>
        </form>

        <div className="flex items-center gap-3">
          <Separator className="flex-1" />
          <span className="text-xs text-muted-foreground">or</span>
          <Separator className="flex-1" />
        </div>

        <Button
          type="button"
          variant="outline"
          className="w-full"
          size="lg"
          onClick={onGoogleSignIn}
        >
          <GoogleIcon data-icon="inline-start" />
          {googleButtonLabel}
        </Button>

        <div className="flex flex-col gap-2 text-center text-sm">
          <button
            type="button"
            onClick={() => {
              onModeChange(mode === "signin" ? "signup" : "signin")
            }}
            className="text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
          >
            {toggleModeLabel}
          </button>
          {onContinueWithoutAuth ? (
            <div>
              <button
                type="button"
                onClick={onContinueWithoutAuth}
                className="text-muted-foreground/70 underline-offset-4 transition-colors hover:text-foreground hover:underline"
              >
                {continueWithoutAuthLabel}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
