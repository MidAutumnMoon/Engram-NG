/**
 * CombinedReview — two-section review modal for the unified ingestion pass.
 *
 * Renders <SummaryReview> and <EntityReview> as stacked sections within a
 * single review request. Each section edits its own slice of the combined
 * `data` bag; the parent ReviewSession's shared footer drives the overall
 * confirm/cancel.
 *
 * The combined `data` payload uses non-colliding keys:
 *   - summaryContent: string  (summary text, for SummaryReview)
 *   - summaryData:    any     (summary events)
 *   - entityData:     { newEntities, updatedEntities }
 *
 * The orchestrator decides per-section follow-up (e.g. summary reroll) based
 * on the global action + which section changed. This component stays
 * presentational: it just composes the two existing editors.
 */
import React from "react";
import { SummaryReview } from "./SummaryReview.tsx";
import { EntityReview } from "./EntityReview.tsx";

export interface CombinedReviewData {
    /** Summary section text (the JSON `{events:[...]}` string). */
    summaryContent?: string;
    /** Summary section parsed events. */
    summaryData?: any;
    /** Entity section new/updated entities. */
    entityData?: {
        newEntities?: any[];
        updatedEntities?: any[];
    };
}

interface CombinedReviewProps {
    /** Combined payload. Falls back to empty sections when absent. */
    data?: CombinedReviewData;
    /**
     * Report combined edits up to the session. The session packs this into
     * its top-level `data` so the shared footer / onResult carry it.
     */
    onChange: (data: CombinedReviewData) => void;
}

export const CombinedReview: React.FC<CombinedReviewProps> = (
    { data, onChange },
) => {
    const summaryContent = data?.summaryContent ?? "";
    const summaryData = data?.summaryData;
    const entityData = {
        newEntities: data?.entityData?.newEntities ?? [],
        updatedEntities: data?.entityData?.updatedEntities ?? [],
    };

    return (
        <div className="space-y-8">
            {/* Summary section */}
            <section>
                <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
                    剧情摘要
                </h3>
                <SummaryReview
                    content={summaryContent}
                    data={summaryData}
                    onChange={(newContent, newData) => {
                        onChange({
                            ...data,
                            summaryContent: newContent,
                            summaryData: newData,
                        });
                    }}
                />
            </section>

            {/* Divider */}
            <div className="border-t border-border" />

            {/* Entity section */}
            <section>
                <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
                    实体提取
                </h3>
                <EntityReview
                    data={entityData}
                    onChange={(newEntityData) => {
                        onChange({
                            ...data,
                            entityData: newEntityData,
                        });
                    }}
                />
            </section>
        </div>
    );
};
