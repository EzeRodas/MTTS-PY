const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, 'src', 'ui', 'web', 'scripts');
const destDir = path.join(__dirname, 'src', 'ui', 'web', 'dist');

if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
}

const bundles = {
    'main_bundle.js': [
        'bridge_init.js',
        'main/shortcut_handler.js',
        'main/synthesis_handler.js',
        'main/window_drag.js',
        'main/main_control.js'
    ],
    'settings_bundle.js': [
        'bridge_init.js',
        'settings/settings_loader.js',
        'settings/settings_window.js'
    ],
    'advanced_bundle.js': [
        'advanced/advanced_tabs.js',
        'advanced/advanced_general.js',
        'advanced/advanced_audio.js',
        'advanced/advanced_engine.js',
        'advanced/advanced_hotkeys.js',
        'advanced/advanced_history.js',
        'advanced/advanced_dictionary.js',
        'advanced/advanced_engine_management.js'
    ],
    'setup_bundle.js': [
        'bridge_init.js',
        'setup.js'
    ]
};

for (const [bundleName, files] of Object.entries(bundles)) {
    let concatenatedCode = '';
    for (const file of files) {
        const filePath = path.join(srcDir, file);
        if (fs.existsSync(filePath)) {
            concatenatedCode += fs.readFileSync(filePath, 'utf8') + '\n';
        } else {
            console.error(`Warning: File not found: ${filePath}`);
        }
    }
    
    const result = esbuild.transformSync(concatenatedCode, { 
        minify: true,
        target: 'es2020'
    });
    
    fs.writeFileSync(path.join(destDir, bundleName), result.code);
    console.log(`Created ${bundleName}`);
}

console.log('Build complete.');
