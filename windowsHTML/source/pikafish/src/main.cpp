#include <emscripten/emscripten.h>

#include <algorithm>
#include <map>
#include <memory>
#include <sstream>
#include <string>
#include <string_view>
#include <vector>

#include "attacks.h"
#include "engine.h"
#include "position.h"
#include "search.h"
#include "uci.h"

using namespace Stockfish;

namespace {

std::unique_ptr<Engine> engine;
std::string             result;

void option(const std::string& name, const std::string& value) {
    std::istringstream command("name " + name + " value " + value);
    engine->get_options().setoption(command);
}

std::string escape_json(std::string_view value) {
    std::string escaped;
    escaped.reserve(value.size() + 8);
    for (char c : value)
    {
        switch (c)
        {
        case '"': escaped += "\\\""; break;
        case '\\': escaped += "\\\\"; break;
        case '\n':
        case '\r': escaped += ' '; break;
        default: escaped += c; break;
        }
    }
    return escaped;
}

std::vector<std::string> split_moves(const char* value) {
    std::vector<std::string> moves;
    if (!value)
        return moves;
    std::istringstream input(value);
    for (std::string move; input >> move;)
        moves.push_back(std::move(move));
    return moves;
}

struct Line {
    int         depth;
    usize       multipv;
    std::string score;
    std::string pv;
};

}  // namespace

extern "C" {

EMSCRIPTEN_KEEPALIVE const char* pikafish_init() {
    if (!engine)
    {
        Attacks::init();
        Position::init();
        engine = std::make_unique<Engine>();
        option("Threads", "1");
        option("Hash", "32");
        option("EvalFile", "/pikafish.nnue");
        engine->set_on_update_no_moves([](const Engine::InfoShort&) {});
        engine->set_on_iter([](const Engine::InfoIter&) {});
        engine->set_on_start([]() {});
        engine->set_on_verify_network([](std::string_view) {});
        engine->set_on_bestmove([](std::string_view, std::string_view) {});
    }
    result = "ready";
    return result.c_str();
}

EMSCRIPTEN_KEEPALIVE const char* pikafish_analyze(const char* fen,
                                                  int         depth,
                                                  int         multipv,
                                                  const char* searchMoves,
                                                  int         elo) {
    pikafish_init();
    depth   = std::clamp(depth, 1, 30);
    multipv = std::clamp(multipv, 1, 64);
    option("MultiPV", std::to_string(multipv));
    option("UCI_LimitStrength", elo ? "true" : "false");
    if (elo)
        option("UCI_Elo",
               std::to_string(std::clamp(elo, Search::Skill::LowestElo,
                                         Search::Skill::HighestElo)));

    if (!fen || engine->set_position(fen, {}))
    {
        result = "[{\"error\":\"invalid fen\"}]";
        return result.c_str();
    }

    std::map<usize, Line> lines;
    std::string bestmove;
    engine->set_on_bestmove(
      [&](std::string_view move, std::string_view) { bestmove = move; });
    engine->set_on_update_full([&](const Engine::InfoFull& info) {
        if (info.multiPV == 0 || info.multiPV > static_cast<usize>(multipv))
            return;
        Line line;
        line.depth   = static_cast<int>(info.depth);
        line.multipv = info.multiPV;
        line.score   = UCIEngine::format_score(info.score);
        line.pv      = info.pv;
        lines[info.multiPV] = std::move(line);
    });

    Search::LimitsType limits;
    limits.depth       = depth;
    limits.startTime   = now();
    limits.searchmoves = split_moves(searchMoves);
    engine->go(limits);
    engine->wait_for_search_finished();

    if (const auto firstLine = lines.find(1);
        elo && !bestmove.empty() && firstLine != lines.end())
    {
        auto& pv = firstLine->second.pv;
        const auto separator = pv.find(' ');
        pv = bestmove + (separator == std::string::npos ? "" : pv.substr(separator));
    }
    option("UCI_LimitStrength", "false");

    result = "[";
    bool first = true;
    for (const auto& [index, line] : lines)
    {
        if (!first)
            result += ',';
        first = false;
        result += "{\"depth\":" + std::to_string(line.depth)
                + ",\"multipv\":" + std::to_string(line.multipv)
                + ",\"score\":\"" + escape_json(line.score)
                + "\",\"pv\":\"" + escape_json(line.pv) + "\"}";
    }
    result += ']';
    return result.c_str();
}

}  // extern "C"

int main() { return 0; }
