#!/usr/bin/env node

/**
 * Release preparation script for LM Studio Kiro Extension
 * This script helps prepare the extension for marketplace publication
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const packagePath = path.join(__dirname, '..', 'package.json');
const changelogPath = path.join(__dirname, '..', 'CHANGELOG.md');

function updateVersion(newVersion) {
  console.log(`📦 Updating version to ${newVersion}...`);
  
  // Update package.json
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  packageJson.version = newVersion;
  fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 2) + '\n');
  
  console.log('✅ Version updated in package.json');
}

function validatePackage() {
  console.log('🔍 Validating package configuration...');
  
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  
  const required = ['name', 'displayName', 'description', 'version', 'publisher', 'engines'];
  const missing = required.filter(field => !packageJson[field]);
  
  if (missing.length > 0) {
    console.error('❌ Missing required fields:', missing.join(', '));
    process.exit(1);
  }
  
  console.log('✅ Package configuration is valid');
}

function runTests() {
  console.log('🧪 Running tests...');
  try {
    execSync('npm test', { stdio: 'inherit' });
    console.log('✅ All tests passed');
  } catch (error) {
    console.error('❌ Tests failed');
    process.exit(1);
  }
}

function lintCode() {
  console.log('🔧 Linting code...');
  try {
    execSync('npm run lint', { stdio: 'inherit' });
    console.log('✅ Code linting passed');
  } catch (error) {
    console.error('❌ Linting failed');
    process.exit(1);
  }
}

function buildExtension() {
  console.log('🏗️  Building extension...');
  try {
    execSync('npm run package', { stdio: 'inherit' });
    console.log('✅ Extension built successfully');
  } catch (error) {
    console.error('❌ Build failed');
    process.exit(1);
  }
}

function packageExtension() {
  console.log('📦 Packaging extension...');
  try {
    execSync('npm run package-extension', { stdio: 'inherit' });
    console.log('✅ Extension packaged successfully');
  } catch (error) {
    console.error('❌ Packaging failed');
    process.exit(1);
  }
}

function main() {
  const args = process.argv.slice(2);
  const newVersion = args[0];
  
  console.log('🚀 Preparing LM Studio Kiro Extension for release...\n');
  
  if (newVersion) {
    updateVersion(newVersion);
  }
  
  validatePackage();
  lintCode();
  runTests();
  buildExtension();
  packageExtension();
  
  console.log('\n🎉 Release preparation complete!');
  console.log('📋 Next steps:');
  console.log('   1. Review the generated .vsix file');
  console.log('   2. Test the packaged extension');
  console.log('   3. Update CHANGELOG.md with release notes');
  console.log('   4. Commit and tag the release');
  console.log('   5. Publish to Open VSX Registry');
}

if (require.main === module) {
  main();
}

module.exports = {
  updateVersion,
  validatePackage,
  runTests,
  lintCode,
  buildExtension,
  packageExtension
};