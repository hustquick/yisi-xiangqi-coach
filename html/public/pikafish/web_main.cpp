#include <emscripten/emscripten.h>
#include <memory>
#include <sstream>
#include <string>
#include <vector>
#include "attacks.h"
#include "engine.h"
#include "position.h"
#include "search.h"
#include "uci.h"

using namespace Stockfish;

static std::unique_ptr<Engine> engine;
static std::string result;

static void option(const std::string& name, const std::string& value) {
    std::istringstream command("name " + name + " value " + value);
    engine->get_options().setoption(command);
}

static std::string esc(std::string_view s) {
    std::string out;
    for (char c : s) {
        if (c == '"' || c == '\\') out += '\\';
        if (c == '\n' || c == '\r') out += ' '; else out += c;
    }
    return out;
}

extern "C" {
EMSCRIPTEN_KEEPALIVE const char* pikafish_init() {
    if (!engine) {
        Attacks::init();
        Position::init();
        engine = std::make_unique<Engine>();
        option("Threads", "1");
        option("Hash", "16");
        option("EvalFile", "/pikafish.nnue");
        engine->set_on_update_no_moves([](const Engine::InfoShort&) {});
        engine->set_on_iter([](const Engine::InfoIter&) {});
        engine->set_on_start([]() {});
        engine->set_on_verify_network([](std::string_view) {});
    }
    result = "ready";
    return result.c_str();
}

EMSCRIPTEN_KEEPALIVE const char* pikafish_analyze(const char* fen, int depth, int multipv) {
    pikafish_init();
    result = "[";
    bool first = true;
    option("MultiPV", std::to_string(multipv));
    if (auto error = engine->set_position(fen, {})) {
        result = "[{\"error\":\"invalid fen\"}]";
        return result.c_str();
    }
    engine->set_on_update_full([&](const Engine::InfoFull& info) {
        if (info.depth != depth || info.multiPV > (usize)multipv) return;
        if (!first) result += ',';
        first = false;
        result += "{\"depth\":" + std::to_string(info.depth)
          + ",\"multipv\":" + std::to_string(info.multiPV)
          + ",\"score\":\"" + esc(UCIEngine::format_score(info.score))
          + "\",\"pv\":\"" + esc(info.pv) + "\"}";
    });
    engine->set_on_bestmove([](std::string_view, std::string_view) {});
    Search::LimitsType limits;
    limits.depth = depth;
    limits.startTime = now();
    engine->go(limits);
    engine->wait_for_search_finished();
    result += "]";
    return result.c_str();
}
}

int main() { return 0; }
