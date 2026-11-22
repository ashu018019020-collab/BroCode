import type { FeedbackData } from "@/types/response";
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";

const supabase = createClientComponentClient();

const submitFeedback = async (feedbackData: FeedbackData) => {
  const { error, data } = await supabase.from("feedback").insert(feedbackData).select();

  if (error) {
    console.error("Error submitting feedback:", error);
    throw error;
  }

  return data;
};

export const FeedbackService = {
  submitFeedback,
};
