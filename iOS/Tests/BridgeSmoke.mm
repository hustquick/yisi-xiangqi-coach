#include <cstdlib>
#include <iostream>
#include <string>

#include "PikafishBridge.h"

namespace {
constexpr const char *InitialFEN =
  "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1";

void require(bool condition, const std::string& message) {
    if (!condition)
    {
        std::cerr << "FAIL: " << message << '\n';
        std::exit(1);
    }
}
}  // namespace

int main(int argc, char **argv) {
    require(argc == 2, "pass the local pikafish.nnue path");

    const std::string initialized = pf_initialize(argv[1], 2, 32);
    require(initialized == "ready", initialized);

    const std::string legal = pf_legal_moves(InitialFEN);
    require(legal.find("h2e2") != std::string::npos, "initial position must allow 炮二平五 (h2e2)");
    require(legal.find("h0g2") != std::string::npos, "initial position must allow 马二进三 (h0g2)");
    require(legal.find("h0f0") == std::string::npos, "horse cannot move horizontally");

    const std::string after = pf_apply_move(InitialFEN, "h2e2");
    require(after.find(" b ") != std::string::npos, "side to move must change after a legal move");
    require(std::string(pf_apply_move(InitialFEN, "h0f0")).find("error:illegal move") == 0,
            "illegal moves must be rejected by Pikafish");

    const std::string analysis = pf_analyze(InitialFEN, 4, 3, "");
    require(analysis.find("\"lines\":[{") != std::string::npos, "analysis must contain engine lines");
    require(analysis.find("\"depth\":4") != std::string::npos, "analysis must reach requested depth");
    require(analysis.find("\"score\":\"") != std::string::npos, "analysis must contain scores");

    // Regression: Engine retains its update callback between searches. This
    // sequence used to call pf_analyze's destroyed stack state and abort when
    // selecting the lowest Elo level on iOS.
    const std::string amateurMove = pf_best_move(InitialFEN, 4, 1320);
    require(amateurMove.size() >= 4 && amateurMove.rfind("error:", 0) != 0,
            "Elo 1320 best move must complete after coach analysis");

    std::cout << "PASS: legal moves, analysis, and Elo 1320 best move are working.\n";
    return 0;
}
