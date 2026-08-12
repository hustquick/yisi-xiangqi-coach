#!/usr/bin/env ruby
# frozen_string_literal: true

require "digest"
require "fileutils"

ROOT = File.expand_path(__dir__)
PROJECT_NAME = "YisiXiangqiCoach"
PROJECT_DIR = File.join(ROOT, "#{PROJECT_NAME}.xcodeproj")

def uuid(label)
  Digest::SHA1.hexdigest(label).upcase[0, 24]
end

def quote(value)
  return value if value.match?(/\A[A-Za-z0-9_.$()\/+-]+\z/)
  %Q{"#{value.gsub('"', '\\"')}"}
end

swift_files = Dir.glob(File.join(ROOT, "App", "*.swift")).sort.map { |path| path.delete_prefix("#{ROOT}/") }
cpp_files = Dir.glob(File.join(ROOT, "ThirdParty", "Pikafish", "src", "**", "*.cpp")).sort
  .reject { |path| path.end_with?("/main.cpp") || path.include?("/universal/") }
  .map { |path| path.delete_prefix("#{ROOT}/") }
source_files = swift_files + ["Bridge/PikafishBridge.mm"] + cpp_files
resource_files = ["App/Resources/AppIcon.png", "App/Resources/AppIconDark.png", "App/Resources/pikafish.nnue", "ThirdParty/Pikafish/COPYING.txt"]
visible_files = source_files + resource_files + ["App/Info.plist", "Bridge/PikafishBridge.h"]

missing = visible_files.reject { |path| File.exist?(File.join(ROOT, path)) }
abort "Missing required files: #{missing.join(', ')}" unless missing.empty?

file_type = lambda do |path|
  case File.extname(path)
  when ".swift" then "sourcecode.swift"
  when ".mm" then "sourcecode.cpp.objcpp"
  when ".cpp" then "sourcecode.cpp.cpp"
  when ".h" then "sourcecode.c.h"
  when ".plist" then "text.plist.xml"
  when ".png" then "image.png"
  when ".txt" then "text"
  else "file"
  end
end

project_id = uuid("project")
target_id = uuid("target")
main_group_id = uuid("main-group")
app_group_id = uuid("app-group")
bridge_group_id = uuid("bridge-group")
engine_group_id = uuid("engine-group")
products_group_id = uuid("products-group")
product_ref_id = uuid("product-ref")
sources_phase_id = uuid("sources-phase")
resources_phase_id = uuid("resources-phase")
frameworks_phase_id = uuid("frameworks-phase")
project_config_list_id = uuid("project-config-list")
target_config_list_id = uuid("target-config-list")
project_debug_id = uuid("project-debug")
project_release_id = uuid("project-release")
target_debug_id = uuid("target-debug")
target_release_id = uuid("target-release")

file_refs = visible_files.to_h { |path| [path, uuid("ref:#{path}")] }
build_files = (source_files + resource_files).to_h { |path| [path, uuid("build:#{path}")] }

app_children = visible_files.select { |path| path.start_with?("App/") }.map { |path| file_refs[path] }
bridge_children = visible_files.select { |path| path.start_with?("Bridge/") }.map { |path| file_refs[path] }
engine_children = visible_files.select { |path| path.start_with?("ThirdParty/") }.map { |path| file_refs[path] }

pbx = []
pbx << "// !$*UTF8*$!"
pbx << "{"
pbx << "\tarchiveVersion = 1;"
pbx << "\tclasses = {};"
pbx << "\tobjectVersion = 77;"
pbx << "\tobjects = {"

pbx << "\n/* Begin PBXBuildFile section */"
(source_files + resource_files).each do |path|
  pbx << "\t\t#{build_files[path]} /* #{File.basename(path)} in #{source_files.include?(path) ? 'Sources' : 'Resources'} */ = {isa = PBXBuildFile; fileRef = #{file_refs[path]} /* #{File.basename(path)} */; };"
end
pbx << "/* End PBXBuildFile section */"

pbx << "\n/* Begin PBXFileReference section */"
visible_files.each do |path|
  pbx << "\t\t#{file_refs[path]} /* #{File.basename(path)} */ = {isa = PBXFileReference; lastKnownFileType = #{file_type.call(path)}; path = #{quote(path)}; sourceTree = \"<group>\"; };"
end
pbx << "\t\t#{product_ref_id} /* #{PROJECT_NAME}.app */ = {isa = PBXFileReference; explicitFileType = wrapper.application; includeInIndex = 0; path = #{PROJECT_NAME}.app; sourceTree = BUILT_PRODUCTS_DIR; };"
pbx << "/* End PBXFileReference section */"

pbx << "\n/* Begin PBXFrameworksBuildPhase section */"
pbx << "\t\t#{frameworks_phase_id} /* Frameworks */ = {isa = PBXFrameworksBuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0; };"
pbx << "/* End PBXFrameworksBuildPhase section */"

group = lambda do |id, name, children|
  pbx << "\t\t#{id} /* #{name} */ = {"
  pbx << "\t\t\tisa = PBXGroup;"
  pbx << "\t\t\tchildren = ("
  children.each { |child| pbx << "\t\t\t\t#{child}," }
  pbx << "\t\t\t);"
  pbx << "\t\t\tname = #{quote(name)};"
  pbx << "\t\t\tsourceTree = \"<group>\";"
  pbx << "\t\t};"
end

pbx << "\n/* Begin PBXGroup section */"
group.call(main_group_id, PROJECT_NAME, ["#{app_group_id} /* App */", "#{bridge_group_id} /* Bridge */", "#{engine_group_id} /* Pikafish */", "#{products_group_id} /* Products */"])
group.call(app_group_id, "App", app_children.map { |id| "#{id} /* #{File.basename(file_refs.key(id))} */" })
group.call(bridge_group_id, "Bridge", bridge_children.map { |id| "#{id} /* #{File.basename(file_refs.key(id))} */" })
group.call(engine_group_id, "Pikafish", engine_children.map { |id| "#{id} /* #{File.basename(file_refs.key(id))} */" })
group.call(products_group_id, "Products", ["#{product_ref_id} /* #{PROJECT_NAME}.app */"])
pbx << "/* End PBXGroup section */"

pbx << "\n/* Begin PBXNativeTarget section */"
pbx << "\t\t#{target_id} /* #{PROJECT_NAME} */ = {"
pbx << "\t\t\tisa = PBXNativeTarget;"
pbx << "\t\t\tbuildConfigurationList = #{target_config_list_id} /* Build configuration list for PBXNativeTarget \"#{PROJECT_NAME}\" */;"
pbx << "\t\t\tbuildPhases = (#{sources_phase_id} /* Sources */, #{frameworks_phase_id} /* Frameworks */, #{resources_phase_id} /* Resources */);"
pbx << "\t\t\tbuildRules = ();"
pbx << "\t\t\tdependencies = ();"
pbx << "\t\t\tname = #{PROJECT_NAME};"
pbx << "\t\t\tproductName = #{PROJECT_NAME};"
pbx << "\t\t\tproductReference = #{product_ref_id} /* #{PROJECT_NAME}.app */;"
pbx << "\t\t\tproductType = \"com.apple.product-type.application\";"
pbx << "\t\t};"
pbx << "/* End PBXNativeTarget section */"

pbx << "\n/* Begin PBXProject section */"
pbx << "\t\t#{project_id} /* Project object */ = {"
pbx << "\t\t\tisa = PBXProject;"
pbx << "\t\t\tattributes = {BuildIndependentTargetsInParallel = 1; LastSwiftUpdateCheck = 2650; LastUpgradeCheck = 2650; TargetAttributes = {#{target_id} = {CreatedOnToolsVersion = 26.5; }; }; };"
pbx << "\t\t\tbuildConfigurationList = #{project_config_list_id} /* Build configuration list for PBXProject \"#{PROJECT_NAME}\" */;"
pbx << "\t\t\tdevelopmentRegion = zh_CN;"
pbx << "\t\t\thasScannedForEncodings = 0;"
pbx << "\t\t\tknownRegions = (zh_CN, en, Base);"
pbx << "\t\t\tmainGroup = #{main_group_id};"
pbx << "\t\t\tproductRefGroup = #{products_group_id} /* Products */;"
pbx << "\t\t\tprojectDirPath = \"\";"
pbx << "\t\t\tprojectRoot = \"\";"
pbx << "\t\t\ttargets = (#{target_id} /* #{PROJECT_NAME} */);"
pbx << "\t\t};"
pbx << "/* End PBXProject section */"

pbx << "\n/* Begin PBXResourcesBuildPhase section */"
pbx << "\t\t#{resources_phase_id} /* Resources */ = {isa = PBXResourcesBuildPhase; buildActionMask = 2147483647; files = ("
resource_files.each { |path| pbx << "\t\t\t#{build_files[path]} /* #{File.basename(path)} in Resources */," }
pbx << "\t\t); runOnlyForDeploymentPostprocessing = 0; };"
pbx << "/* End PBXResourcesBuildPhase section */"

pbx << "\n/* Begin PBXSourcesBuildPhase section */"
pbx << "\t\t#{sources_phase_id} /* Sources */ = {isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = ("
source_files.each { |path| pbx << "\t\t\t#{build_files[path]} /* #{File.basename(path)} in Sources */," }
pbx << "\t\t); runOnlyForDeploymentPostprocessing = 0; };"
pbx << "/* End PBXSourcesBuildPhase section */"

project_debug = {
  "ALWAYS_SEARCH_USER_PATHS" => "NO", "CLANG_ANALYZER_NONNULL" => "YES",
  "CLANG_CXX_LANGUAGE_STANDARD" => '"gnu++20"', "CLANG_CXX_LIBRARY" => '"libc++"',
  "CLANG_ENABLE_MODULES" => "YES", "CLANG_ENABLE_OBJC_ARC" => "YES",
  "COPY_PHASE_STRIP" => "NO", "DEBUG_INFORMATION_FORMAT" => "dwarf",
  "ENABLE_TESTABILITY" => "YES", "GCC_C_LANGUAGE_STANDARD" => "gnu17",
  "GCC_OPTIMIZATION_LEVEL" => "0", "IPHONEOS_DEPLOYMENT_TARGET" => "17.0",
  "ONLY_ACTIVE_ARCH" => "YES", "SDKROOT" => "iphoneos", "SWIFT_ACTIVE_COMPILATION_CONDITIONS" => "DEBUG"
}
project_release = project_debug.merge(
  "COPY_PHASE_STRIP" => "YES", "DEBUG_INFORMATION_FORMAT" => '"dwarf-with-dsym"',
  "ENABLE_NS_ASSERTIONS" => "NO", "GCC_OPTIMIZATION_LEVEL" => "s", "ONLY_ACTIVE_ARCH" => "NO",
  "SWIFT_ACTIVE_COMPILATION_CONDITIONS" => '""', "VALIDATE_PRODUCT" => "YES"
)
target_common = {
  "ARCHS" => "arm64", "CODE_SIGN_STYLE" => "Automatic", "CURRENT_PROJECT_VERSION" => "1",
  "DEVELOPMENT_TEAM" => "BKLF8453MJ",
  "GCC_PREPROCESSOR_DEFINITIONS" => '("$(inherited)", NDEBUG, IS_64BIT, USE_POPCNT, "USE_NEON=8")',
  "HEADER_SEARCH_PATHS" => '("$(inherited)", "$(PROJECT_DIR)/ThirdParty/Pikafish/src")',
  "INFOPLIST_FILE" => "App/Info.plist", "IPHONEOS_DEPLOYMENT_TARGET" => "17.0",
  "LD_RUNPATH_SEARCH_PATHS" => '("$(inherited)", "@executable_path/Frameworks")',
  "MARKETING_VERSION" => "1.0", "OTHER_CPLUSPLUSFLAGS" => '("$(inherited)", "-Wno-deprecated-enum-enum-conversion")',
  "PRODUCT_BUNDLE_IDENTIFIER" => "com.yisi.xiangqicoach", "PRODUCT_NAME" => '"$(TARGET_NAME)"',
  "SWIFT_OBJC_BRIDGING_HEADER" => "Bridge/PikafishBridge.h", "SWIFT_VERSION" => "5.0",
  "TARGETED_DEVICE_FAMILY" => '"1,2"'
}
target_debug = target_common.merge("SWIFT_OPTIMIZATION_LEVEL" => '"-Onone"')
target_release = target_common.merge("SWIFT_OPTIMIZATION_LEVEL" => '"-O"')

emit_config = lambda do |id, name, settings|
  pbx << "\t\t#{id} /* #{name} */ = {isa = XCBuildConfiguration; buildSettings = {"
  settings.each { |key, value| pbx << "\t\t\t#{key} = #{value};" }
  pbx << "\t\t}; name = #{name}; };"
end

pbx << "\n/* Begin XCBuildConfiguration section */"
emit_config.call(project_debug_id, "Debug", project_debug)
emit_config.call(project_release_id, "Release", project_release)
emit_config.call(target_debug_id, "Debug", target_debug)
emit_config.call(target_release_id, "Release", target_release)
pbx << "/* End XCBuildConfiguration section */"

pbx << "\n/* Begin XCConfigurationList section */"
pbx << "\t\t#{project_config_list_id} /* Build configuration list for PBXProject \"#{PROJECT_NAME}\" */ = {isa = XCConfigurationList; buildConfigurations = (#{project_debug_id} /* Debug */, #{project_release_id} /* Release */); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release; };"
pbx << "\t\t#{target_config_list_id} /* Build configuration list for PBXNativeTarget \"#{PROJECT_NAME}\" */ = {isa = XCConfigurationList; buildConfigurations = (#{target_debug_id} /* Debug */, #{target_release_id} /* Release */); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release; };"
pbx << "/* End XCConfigurationList section */"

pbx << "\t};"
pbx << "\trootObject = #{project_id} /* Project object */;"
pbx << "}"

FileUtils.mkdir_p(PROJECT_DIR)
File.write(File.join(PROJECT_DIR, "project.pbxproj"), pbx.join("\n") + "\n")
puts "Generated #{PROJECT_DIR} with #{source_files.length} source files."
