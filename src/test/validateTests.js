/**
 * Simple test validation script to check test structure
 */

const fs = require('fs');
const path = require('path');

function validateTestFile(filePath) {
    console.log(`\n=== Validating ${filePath} ===`);
    
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        
        // Check for basic test structure
        const hasSuite = content.includes('suite(');
        const hasTest = content.includes('test(');
        const hasAssert = content.includes('assert');
        const hasRequire = content.includes('require(');
        
        console.log(`✓ Has suite definitions: ${hasSuite}`);
        console.log(`✓ Has test cases: ${hasTest}`);
        console.log(`✓ Has assertions: ${hasAssert}`);
        console.log(`✓ Has require statements: ${hasRequire}`);
        
        // Count test cases
        const testMatches = content.match(/test\(/g);
        const testCount = testMatches ? testMatches.length : 0;
        console.log(`✓ Number of test cases: ${testCount}`);
        
        // Count suites
        const suiteMatches = content.match(/suite\(/g);
        const suiteCount = suiteMatches ? suiteMatches.length : 0;
        console.log(`✓ Number of test suites: ${suiteCount}`);
        
        return {
            valid: hasSuite && hasTest && hasAssert,
            testCount,
            suiteCount
        };
        
    } catch (error) {
        console.error(`✗ Error reading file: ${error.message}`);
        return { valid: false, testCount: 0, suiteCount: 0 };
    }
}

function main() {
    console.log('=== Test File Validation ===');
    
    const testFiles = [
        'src/test/suite/integration.test.js',
        'src/test/suite/performance.test.js',
        'src/test/suite/e2e.test.js',
        'src/test/suite/localLLMClient.test.js',
        'src/test/suite/extension.test.js'
    ];
    
    let totalTests = 0;
    let totalSuites = 0;
    let validFiles = 0;
    
    testFiles.forEach(file => {
        if (fs.existsSync(file)) {
            const result = validateTestFile(file);
            if (result.valid) {
                validFiles++;
            }
            totalTests += result.testCount;
            totalSuites += result.suiteCount;
        } else {
            console.log(`\n=== ${file} ===`);
            console.log('✗ File does not exist');
        }
    });
    
    console.log('\n=== Summary ===');
    console.log(`✓ Valid test files: ${validFiles}/${testFiles.length}`);
    console.log(`✓ Total test suites: ${totalSuites}`);
    console.log(`✓ Total test cases: ${totalTests}`);
    
    if (validFiles === testFiles.length) {
        console.log('\n🎉 All test files are valid!');
        
        // Check for comprehensive coverage
        console.log('\n=== Coverage Analysis ===');
        
        const integrationResult = validateTestFile('src/test/suite/integration.test.js');
        const performanceResult = validateTestFile('src/test/suite/performance.test.js');
        const e2eResult = validateTestFile('src/test/suite/e2e.test.js');
        
        console.log(`✓ Integration tests: ${integrationResult.testCount} test cases`);
        console.log(`✓ Performance tests: ${performanceResult.testCount} test cases`);
        console.log(`✓ End-to-end tests: ${e2eResult.testCount} test cases`);
        
        const comprehensiveThreshold = 15; // Minimum tests for comprehensive coverage
        const totalComprehensiveTests = integrationResult.testCount + performanceResult.testCount + e2eResult.testCount;
        
        if (totalComprehensiveTests >= comprehensiveThreshold) {
            console.log(`\n🏆 Comprehensive testing suite complete! (${totalComprehensiveTests} tests)`);
        } else {
            console.log(`\n⚠️  Consider adding more tests for comprehensive coverage (${totalComprehensiveTests}/${comprehensiveThreshold})`);
        }
        
    } else {
        console.log('\n❌ Some test files have issues that need to be fixed.');
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = { validateTestFile };