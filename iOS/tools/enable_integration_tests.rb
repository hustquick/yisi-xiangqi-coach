#!/usr/bin/env ruby
# Add a host-app XCTest target to the deterministic generated project.
require 'digest'
require 'fileutils'
root = File.expand_path('..', __dir__)
path = File.join(root,'YisiXiangqiCoach.xcodeproj','project.pbxproj')
uuid = ->(key) { Digest::SHA1.hexdigest(key).upcase[0,24] }
app = uuid.call('target'); target = uuid.call('mobile-tests-target')
ids = %w[ref build product sources frameworks resources config debug release proxy dependency].to_h { |key| [key,uuid.call("mobile-tests-#{key}")] }
text = File.read(path)
abort 'Generate the project before enabling tests' if text.include?('MobileIntegrationTests.swift')
objects = <<~PBX
#{ids['ref']} = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = Tests/MobileIntegrationTests.swift; sourceTree = "<group>"; };
#{ids['build']} = {isa = PBXBuildFile; fileRef = #{ids['ref']}; };
#{ids['product']} = {isa = PBXFileReference; explicitFileType = wrapper.cfbundle; path = MobileIntegrationTests.xctest; sourceTree = BUILT_PRODUCTS_DIR; };
#{ids['sources']} = {isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = (#{ids['build']}); runOnlyForDeploymentPostprocessing = 0; };
#{ids['frameworks']} = {isa = PBXFrameworksBuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0; };
#{ids['resources']} = {isa = PBXResourcesBuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0; };
#{ids['proxy']} = {isa = PBXContainerItemProxy; containerPortal = #{uuid.call('project')}; proxyType = 1; remoteGlobalIDString = #{app}; remoteInfo = YisiXiangqiCoach; };
#{ids['dependency']} = {isa = PBXTargetDependency; target = #{app}; targetProxy = #{ids['proxy']}; };
#{target} = {isa = PBXNativeTarget; buildConfigurationList = #{ids['config']}; buildPhases = (#{ids['sources']},#{ids['frameworks']},#{ids['resources']}); buildRules = (); dependencies = (#{ids['dependency']}); name = MobileIntegrationTests; productName = MobileIntegrationTests; productReference = #{ids['product']}; productType = "com.apple.product-type.bundle.unit-test"; };
#{ids['config']} = {isa = XCConfigurationList; buildConfigurations = (#{ids['debug']},#{ids['release']}); defaultConfigurationIsVisible = 0; defaultConfigurationName = Debug; };
PBX
%w[Debug Release].each do |name|
  objects += <<~PBX
  #{ids[name.downcase]} = {isa = XCBuildConfiguration; buildSettings = {ARCHS = arm64; GENERATE_INFOPLIST_FILE = YES; IPHONEOS_DEPLOYMENT_TARGET = 17.0; PRODUCT_BUNDLE_IDENTIFIER = com.yisi.xiangqicoach.integration-tests; PRODUCT_NAME = "$(TARGET_NAME)"; SDKROOT = iphoneos; SWIFT_VERSION = 5.0; TARGETED_DEVICE_FAMILY = "1,2"; BUNDLE_LOADER = "$(TEST_HOST)"; TEST_HOST = "$(BUILT_PRODUCTS_DIR)/YisiXiangqiCoach.app/$(BUNDLE_EXECUTABLE_FOLDER_PATH)/YisiXiangqiCoach"; LD_RUNPATH_SEARCH_PATHS = ("$(inherited)","@executable_path/Frameworks","@loader_path/Frameworks");}; name = #{name}; };
  PBX
end
text.sub!("\t};\n\trootObject",objects+"\t};\n\trootObject")
text.sub!("targets = (#{app} /* YisiXiangqiCoach */);","targets = (#{app} /* YisiXiangqiCoach */, #{target});")
File.write(path,text)
scheme = File.join(root,'YisiXiangqiCoach.xcodeproj','xcshareddata','xcschemes')
FileUtils.mkdir_p(scheme)
reference = ->(id,name) { %Q{<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="#{id}" BuildableName="#{name}" BlueprintName="#{name.sub(/\.(app|xctest)$/,'')}" ReferencedContainer="container:YisiXiangqiCoach.xcodeproj"/>} }
File.write(File.join(scheme,'MobileIntegration.xcscheme'),<<~XML)
<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="2650" version="1.3">
<BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries><BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="NO" buildForArchiving="NO" buildForAnalyzing="YES">#{reference.call(app,'YisiXiangqiCoach.app')}</BuildActionEntry><BuildActionEntry buildForTesting="YES" buildForRunning="NO" buildForProfiling="NO" buildForArchiving="NO" buildForAnalyzing="YES">#{reference.call(target,'MobileIntegrationTests.xctest')}</BuildActionEntry></BuildActionEntries></BuildAction>
<TestAction buildConfiguration="Debug" shouldUseLaunchSchemeArgsEnv="YES"><Testables><TestableReference skipped="NO">#{reference.call(target,'MobileIntegrationTests.xctest')}</TestableReference></Testables></TestAction>
<LaunchAction buildConfiguration="Debug" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES" debugServiceExtension="internal" allowLocationSimulation="YES"><BuildableProductRunnable runnableDebuggingMode="0">#{reference.call(app,'YisiXiangqiCoach.app')}</BuildableProductRunnable></LaunchAction>
</Scheme>
XML
puts 'Enabled MobileIntegration test scheme'
