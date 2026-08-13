import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../card"

export type NotFoundPageProps = {
  title?: string
  description?: string
}

export function NotFoundPage({
  title = "404",
  description = "The requested page could not be found.",
}: NotFoundPageProps) {
  return (
    <main className="container mx-auto flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Check the URL or return to the home page.
          </p>
        </CardContent>
      </Card>
    </main>
  )
}
