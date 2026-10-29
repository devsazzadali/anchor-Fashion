import { fetchReviewsAction } from "@/app/actions/customer.actions";
import { ReviewsList } from "@/components/customer/ReviewsList";
import { createDbClient } from "@/lib/db/client";
import { redirect } from "next/navigation";
import { WriteReviewButton } from "@/features/customer/WriteReviewButton";

export const metadata = {
  title: "My Reviews | Anchor Fashion",
};

export default async function ReviewsPage() {
  const db = await createDbClient();
  const {
    data: { user },
  } = await db.auth.getUser();

  if (!user) {
    redirect("/auth/login?redirect=/account/reviews");
  }

  const res = await fetchReviewsAction();
  const reviews = res.success && res.data ? res.data : [];

  return (
    <div className="space-y-8">
      <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Reviews &amp; Ratings
          </h1>
          <p className="mt-2 text-muted-foreground">
            Manage your product reviews and see what you've rated.
          </p>
        </div>
        <WriteReviewButton />
      </div>

      <ReviewsList initialReviews={reviews} />
    </div>
  );
}
