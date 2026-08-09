cmake_minimum_required(VERSION 3.22.1)
project(pikafish_jni LANGUAGES CXX)

get_filename_component(PIKAFISH_ROOT
    "${CMAKE_CURRENT_SOURCE_DIR}/../../../../../iOS/ThirdParty/Pikafish/src"
    ABSOLUTE)

file(GLOB_RECURSE PIKAFISH_SOURCES CONFIGURE_DEPENDS "${PIKAFISH_ROOT}/*.cpp")
list(FILTER PIKAFISH_SOURCES EXCLUDE REGEX "/main\\.cpp$")
list(FILTER PIKAFISH_SOURCES EXCLUDE REGEX "/universal/")

add_library(pikafish_jni SHARED pikafish_jni.cpp ${PIKAFISH_SOURCES})
target_include_directories(pikafish_jni PRIVATE "${PIKAFISH_ROOT}")
target_compile_features(pikafish_jni PRIVATE cxx_std_20)
target_compile_definitions(pikafish_jni PRIVATE
    NDEBUG
    IS_64BIT
    USE_POPCNT
    USE_NEON=8)
target_compile_options(pikafish_jni PRIVATE
    -O3
    -Wno-deprecated-enum-enum-conversion
    -Wno-unused-parameter
    -Wno-unused-variable)

find_library(LOG_LIBRARY log)
find_library(ANDROID_LIBRARY android)
target_link_libraries(pikafish_jni PRIVATE ${LOG_LIBRARY} ${ANDROID_LIBRARY})
