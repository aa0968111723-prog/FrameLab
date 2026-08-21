# SDK

TypeScript client: `packages/sdk/src/index.ts`.

```ts
const client = new FrameLabClient({ baseUrl, token });
await client.getFrame({ timelineId, frameNumber: 12 });
await client.analyzeRange({ timelineId, startFrame: 100, endFrame: 200 });
await client.createKeyframePair({ timelineId, startFrame: 100, endFrame: 110, count: 9 });
await client.analyzeTransition({ timelineId, startFrame: 100, endFrame: 110 });
await client.createMotionPlan({ timelineId, startFrame: 100, endFrame: 110, count: 9, curve: "ease_in_out" });
await client.getKeyframePair(pairId);
await client.getMotionPlan(planId);
await client.createInbetweenPlan({ timelineId, startFrame: 100, endFrame: 110, count: 9 });
await client.generateInbetweens({ timelineId, frameA: 100, frameB: 110, count: 9, confirmed: true });
await client.getGenerationJob(jobId);
await client.evaluateInbetweens(candidateId);
await client.regenerateRange({ candidateId, confirmed: true });
await client.acceptCandidate(candidateId);
await client.rejectCandidate(candidateId);
await client.exportFrameSequence({ timelineId, startFrame: 100, endFrame: 110 });
await client.getProblemFrames({ timelineId });
await client.analyzeMotion({ timelineId, startFrame: 120, endFrame: 140 });
await client.analyzePose({ timelineId, startFrame: 120, endFrame: 140 });
await client.getProblemRanges({ timelineId });
await client.createRepairPlan({ timelineId, startFrame: 120, endFrame: 140 });
await client.executeRepairPlan({ planId });
await client.compareRevision(revisionId);
await client.restoreRevision(revisionId);
await client.acceptRevision(revisionId);
await client.repairRange({ timelineId, startFrame: 142, endFrame: 147 });
await client.getJob(jobId);
```
