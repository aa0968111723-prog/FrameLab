# Motion Analysis

**SEA-RAFT-S** is the real optical-flow provider:

`UI → analyze_motion → OPTICAL_FLOW job → sea_raft_worker.py → SEA-RAFT-S → flow/*.json → canvas sampled vectors + motion path`

Two frames actually run inference. `block-match-16` is the CPU fallback only (`provider=block-match-16`).

Output: mean/median magnitude, dominant direction, sampled grid, short advection paths. Spikes when ratio ≥ 2× or direction jumps ≥ 55°.
