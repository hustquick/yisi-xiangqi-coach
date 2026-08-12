#ifndef PikafishBridge_h
#define PikafishBridge_h

#ifdef __cplusplus
extern "C" {
#endif

/// Initializes the embedded Pikafish engine and loads the bundled NNUE network.
/// Returns "ready" on success or a string beginning with "error:".
const char *pf_initialize(const char *eval_file, int threads, int hash_mb);

/// Returns a JSON object with final MultiPV lines for the requested position.
/// search_moves is an optional space-separated list of UCI moves.
const char *pf_analyze(const char *fen, int depth, int multipv, const char *search_moves);

/// Returns a limited-strength best move using the engine's UCI_Elo option.
const char *pf_best_move(const char *fen, int depth, int elo);

/// Returns every legal move as a space-separated UCI string.
const char *pf_legal_moves(const char *fen);

/// Applies one legal UCI move and returns the resulting FEN.
/// Errors are returned as a string beginning with "error:".
const char *pf_apply_move(const char *fen, const char *uci_move);

/// Stops the current search so a newer board action does not wait behind stale analysis.
void pf_stop(void);

#ifdef __cplusplus
}
#endif

#endif
