package com.yisi.xiangqicoach;

final class PikafishNative {
    static { System.loadLibrary("pikafish_jni"); }

    private PikafishNative() {}

    static native String initialize(String evalFile, int threads, int hashMb);
    static native String analyze(String fen, int depth, int multipv, String searchMoves);
    static native String bestMove(String fen, int depth, int elo);
    static native String legalMoves(String fen);
    static native String applyMove(String fen, String move);
    static native void stop();
}
