const spawnAsync = require('@expo/spawn-async');
const fs = require('fs/promises');
const glob = require('glob');
const path = require('path');

const dirName = __dirname; /* eslint-disable-line */

const expoDependencyNames = [
  'expo',
  '@expo/config-plugins',
  '@expo/config-types',
  'expo-application',
  'expo-constants',
  'expo-eas-client',
  'expo-error-recovery',
  'expo-file-system',
  'expo-font',
  'expo-json-utils',
  'expo-keep-awake',
  'expo-manifests',
  'expo-modules-autolinking',
  'expo-modules-core',
  'expo-splash-screen',
  'expo-status-bar',
  'expo-structured-headers',
  'expo-updates',
  'expo-updates-interface',
];

const expoResolutions = {};
const expoVersions = {};

async function packExpoDependency(repoRoot, projectRoot, destPath, dependencyName) {
  // Pack up the named Expo package into the destination folder
  const dependencyComponents = dependencyName.split('/');
  let dependencyPath;
  if (dependencyComponents[0] === '@expo') {
    dependencyPath = path.resolve(
      repoRoot,
      'packages',
      dependencyComponents[0],
      dependencyComponents[1]
    );
  } else {
    dependencyPath = path.resolve(repoRoot, 'packages', dependencyComponents[0]);
  }

  // Save a copy of package.json
  const packageJsonPath = path.resolve(dependencyPath, 'package.json');
  const packageJsonCopyPath = `${packageJsonPath}-original`;
  await fs.copyFile(packageJsonPath, packageJsonCopyPath);
  // Extract the version from package.json
  const packageJson = require(packageJsonPath);
  const originalVersion = packageJson.version;
  // Add string to the version to ensure that yarn uses the tarball and not the published version
  const e2eVersion = `${originalVersion}-${new Date().getTime()}`;
  await fs.writeFile(
    packageJsonPath,
    JSON.stringify(
      {
        ...packageJson,
        version: e2eVersion,
      },
      null,
      2
    )
  );

  await spawnAsync('npm', ['pack', '--pack-destination', destPath], {
    cwd: dependencyPath,
    stdio: 'ignore',
  });

  // Ensure the file was created as expected
  const dependencyTarballName =
    dependencyComponents[0] === '@expo'
      ? `expo-${dependencyComponents[1]}`
      : `${dependencyComponents[0]}`;
  const dependencyTarballPath = glob.sync(path.join(destPath, `${dependencyTarballName}-*.tgz`))[0];

  if (!dependencyTarballPath) {
    throw new Error(`Failed to locate packed ${dependencyName} in ${destPath}`);
  }

  // Restore the original package JSON
  await fs.copyFile(packageJsonCopyPath, packageJsonPath);
  await fs.rm(packageJsonCopyPath);

  // Return the dependency in the form needed by package.json, as a relative path
  const dependency = `.${path.sep}${path.relative(projectRoot, dependencyTarballPath)}`;
  return {
    dependency,
    e2eVersion,
  };
}

async function copyCommonFixturesToProject(projectRoot, appJsFileName) {
  // copy App.js from test fixtures
  const appJsSourcePath = path.resolve(dirName, '..', 'fixtures', appJsFileName);
  const appJsDestinationPath = path.resolve(projectRoot, 'App.js');
  let appJsFileContents = await fs.readFile(appJsSourcePath, 'utf-8');
  appJsFileContents = appJsFileContents
    .replace('UPDATES_HOST', process.env.UPDATES_HOST)
    .replace('UPDATES_PORT', process.env.UPDATES_PORT);
  await fs.writeFile(appJsDestinationPath, appJsFileContents, 'utf-8');

  // pack up project files
  const projectFilesSourcePath = path.join(dirName, '..', 'fixtures', 'project_files');
  const projectFilesTarballPath = path.join(projectRoot, 'project_files.tgz');
  await spawnAsync(
    'tar',
    ['zcf', projectFilesTarballPath, '.detoxrc.json', 'eas.json', 'eas-hooks', 'e2e'],
    {
      cwd: projectFilesSourcePath,
      stdio: 'inherit',
    }
  );

  // unpack project files in project directory
  await spawnAsync('tar', ['zxf', projectFilesTarballPath], {
    cwd: projectRoot,
    stdio: 'inherit',
  });

  // remove project files archive
  await fs.rm(projectFilesTarballPath);
}

async function preparePackageJson(projectRoot, repoRoot, configureE2E) {
  // Create the project subfolder to hold NPM tarballs built from the current state of the repo
  const dependenciesPath = path.join(projectRoot, 'dependencies');
  await fs.mkdir(dependenciesPath);

  for (const dependencyName of expoDependencyNames) {
    console.log(`Packing ${dependencyName}...`);
    const result = await packExpoDependency(
      repoRoot,
      projectRoot,
      dependenciesPath,
      dependencyName
    );
    expoResolutions[dependencyName] = result.dependency;
    expoVersions[dependencyName] = result.dependency;
  }
  console.log('Done packing dependencies.');

  // Additional scripts and dependencies for Detox testing
  const extraScripts = configureE2E
    ? {
        'detox:android:debug:build': 'detox build -c android.debug',
        'detox:android:debug:test': 'detox test -c android.debug',
        'detox:android:release:build': 'detox build -c android.release',
        'detox:android:release:test': 'detox test -c android.release',
        'detox:ios:debug:build': 'detox build -c ios.debug',
        'detox:ios:debug:test': 'detox test -c ios.debug',
        'detox:ios:release:build': 'detox build -c ios.release',
        'detox:ios:release:test': 'detox test -c ios.release',
        'eas-build-pre-install': './eas-hooks/eas-build-pre-install.sh',
        'eas-build-on-success': './eas-hooks/eas-build-on-success.sh',
      }
    : {};

  const extraDevDependencies = configureE2E
    ? {
        '@config-plugins/detox': '^3.0.0',
        detox: '^19.12.1',
        express: '^4.18.2',
        jest: '^29.3.1',
        'jest-circus': '^29.3.1',
      }
    : {};

  // Remove the default Expo dependencies from create-expo-app
  let packageJson = JSON.parse(await fs.readFile(path.join(projectRoot, 'package.json'), 'utf-8'));
  for (const dependencyName of expoDependencyNames) {
    if (packageJson.dependencies[dependencyName]) {
      delete packageJson.dependencies[dependencyName];
    }
  }
  // Add dependencies and resolutions to package.json
  packageJson = {
    ...packageJson,
    scripts: {
      ...packageJson.scripts,
      ...extraScripts,
    },
    dependencies: {
      ...expoResolutions,
      ...packageJson.dependencies,
    },
    devDependencies: {
      ...extraDevDependencies,
      ...packageJson.devDependencies,
    },
    resolutions: {
      ...expoResolutions,
      ...packageJson.resolutions,
    },
  };
  await fs.writeFile(
    path.join(projectRoot, 'package.json'),
    JSON.stringify(packageJson, null, 2),
    'utf-8'
  );
}

async function prepareLocalUpdatesModule(repoRoot) {
  // copy UpdatesE2ETest exported module into the local package
  await fs.copyFile(
    path.resolve(dirName, '..', 'fixtures', 'EXUpdatesE2ETestModule.h'),
    path.join(repoRoot, 'packages', 'expo-updates', 'ios', 'EXUpdates', 'EXUpdatesE2ETestModule.h')
  );
  await fs.copyFile(
    path.resolve(dirName, '..', 'fixtures', 'EXUpdatesE2ETestModule.m'),
    path.join(repoRoot, 'packages', 'expo-updates', 'ios', 'EXUpdates', 'EXUpdatesE2ETestModule.m')
  );
  await fs.copyFile(
    path.resolve(dirName, '..', 'fixtures', 'UpdatesE2ETestModule.kt'),
    path.join(
      repoRoot,
      'packages',
      'expo-updates',
      'android',
      'src',
      'main',
      'java',
      'expo',
      'modules',
      'updates',
      'UpdatesE2ETestModule.kt'
    )
  );

  // export module from UpdatesPackage on Android
  const updatesPackageFilePath = path.join(
    repoRoot,
    'packages',
    'expo-updates',
    'android',
    'src',
    'main',
    'java',
    'expo',
    'modules',
    'updates',
    'UpdatesPackage.kt'
  );
  let updatesPackageFileContents = await fs.readFile(updatesPackageFilePath, 'utf8');
  if (!updatesPackageFileContents) {
    throw new Error('Failed to read UpdatesPackage.kt; was the file renamed or moved?');
  }
  updatesPackageFileContents = updatesPackageFileContents.replace(
    'UpdatesModule(context) as ExportedModule',
    'UpdatesModule(context) as ExportedModule, UpdatesE2ETestModule(context)'
  );
  // make sure the insertion worked
  if (!updatesPackageFileContents.includes('UpdatesE2ETestModule(context)')) {
    throw new Error('Failed to modify UpdatesPackage.kt to insert UpdatesE2ETestModule');
  }
  await fs.writeFile(updatesPackageFilePath, updatesPackageFileContents, 'utf8');
}

function transformAppJsonForE2E(appJson, projectName, runtimeVersion) {
  return {
    ...appJson,
    expo: {
      ...appJson.expo,
      name: projectName,
      owner: 'expo-ci',
      runtimeVersion,
      plugins: ['expo-updates', '@config-plugins/detox'],
      android: { ...appJson.expo.android, package: 'dev.expo.updatese2e' },
      ios: { ...appJson.expo.ios, bundleIdentifier: 'dev.expo.updatese2e' },
      updates: {
        ...appJson.updates,
        url: `http://${process.env.UPDATES_HOST}:${process.env.UPDATES_PORT}/update`,
      },
      extra: {
        eas: {
          projectId: '55685a57-9cf3-442d-9ba8-65c7b39849ef',
        },
      },
    },
  };
}

async function configureUpdatesSigningAsync(projectRoot) {
  // generate and configure code signing
  await spawnAsync(
    'yarn',
    [
      'expo-updates',
      'codesigning:generate',
      '--key-output-directory',
      'keys',
      '--certificate-output-directory',
      'certs',
      '--certificate-validity-duration-years',
      '1',
      '--certificate-common-name',
      'E2E Test App',
    ],
    { cwd: projectRoot, stdio: 'inherit' }
  );
  await spawnAsync(
    'yarn',
    [
      'expo-updates',
      'codesigning:configure',
      '--certificate-input-directory',
      'certs',
      '--key-input-directory',
      'keys',
    ],
    { cwd: projectRoot, stdio: 'inherit' }
  );
}

async function initAsync(
  projectRoot,
  {
    repoRoot,
    runtimeVersion,
    localCliBin,
    configureE2E = true,
    transformAppJson = transformAppJsonForE2E,
  }
) {
  console.log('Creating expo app');
  const workingDir = path.dirname(projectRoot);
  const projectName = path.basename(projectRoot);

  // initialize project (do not do NPM install, we do that later)
  await spawnAsync('yarn', ['create', 'expo-app', projectName, '--yes', '--no-install'], {
    cwd: workingDir,
    stdio: 'inherit',
  });

  if (configureE2E) {
    await prepareLocalUpdatesModule(repoRoot);
  }

  await preparePackageJson(projectRoot, repoRoot, configureE2E);

  // Now we do NPM install
  await spawnAsync('yarn', [], {
    cwd: projectRoot,
    stdio: 'inherit',
  });

  // configure app.json
  let appJson = JSON.parse(await fs.readFile(path.join(projectRoot, 'app.json'), 'utf-8'));
  appJson = transformAppJson(appJson, projectName, runtimeVersion);
  await fs.writeFile(path.join(projectRoot, 'app.json'), JSON.stringify(appJson, null, 2), 'utf-8');

  if (configureE2E) {
    await configureUpdatesSigningAsync(projectRoot);
  }

  // pack local template and prebuild, but do not reinstall NPM
  const localTemplatePath = path.join(repoRoot, 'templates', 'expo-template-bare-minimum');
  await spawnAsync('npm', ['pack', '--pack-destination', projectRoot], {
    cwd: localTemplatePath,
    stdio: 'ignore',
  });

  const localTemplatePathName = glob.sync(
    path.join(projectRoot, 'expo-template-bare-minimum-*.tgz')
  )[0];

  if (!localTemplatePathName) {
    throw new Error(`Failed to locate packed template in ${projectRoot}`);
  }

  await spawnAsync(localCliBin, ['prebuild', '--no-install', '--template', localTemplatePathName], {
    env: {
      ...process.env,
      EXPO_DEBUG: '1',
      CI: '1',
    },
    cwd: projectRoot,
    stdio: 'ignore',
  });

  // We are done with template tarball
  await fs.rm(localTemplatePathName);

  // enable proguard on Android
  await fs.appendFile(
    path.join(projectRoot, 'android', 'gradle.properties'),
    '\nandroid.enableProguardInReleaseBuilds=true',
    'utf-8'
  );

  return projectRoot;
}

async function setupBasicAppAsync(projectRoot) {
  await copyCommonFixturesToProject(projectRoot, 'App.js');

  // export update for test server to host
  await fs.rm(path.join(projectRoot, 'dist'), { force: true, recursive: true });
  await spawnAsync('expo-cli', ['export', '--public-url', 'https://u.expo.dev/dummy-url'], {
    //await spawnAsync(localCliBin, ['export'], {
    cwd: projectRoot,
    stdio: 'inherit',
  });

  // move exported update to "updates" directory for EAS testing
  await fs.rename(path.join(projectRoot, 'dist'), path.join(projectRoot, 'updates'));

  // remove yarn.lock so yarn will work on EAS
  await fs.rm(path.join(projectRoot, 'yarn.lock'));

  // Copy Detox test file to e2e/tests directory
  await fs.copyFile(
    path.resolve(dirName, '..', 'fixtures', 'Updates-basic.e2e.js'),
    path.join(projectRoot, 'e2e', 'tests', 'Updates-basic.e2e.js')
  );
}

async function setupAssetsAppAsync(projectRoot, localCliBin) {
  await copyCommonFixturesToProject(projectRoot, 'App-assets.js');

  // copy png assets and install extra package
  await fs.copyFile(
    path.resolve(dirName, '..', 'fixtures', 'test.png'),
    path.join(projectRoot, 'test.png')
  );
  await spawnAsync(localCliBin, ['install', '@expo-google-fonts/inter'], {
    cwd: projectRoot,
    stdio: 'inherit',
  });

  // export update for test server to host
  await fs.rm(path.join(projectRoot, 'dist'), { force: true, recursive: true });
  await spawnAsync('expo-cli', ['export', '--public-url', 'https://u.expo.dev/dummy-url'], {
    //await spawnAsync(localCliBin, ['export'], {
    cwd: projectRoot,
    stdio: 'inherit',
  });

  // move exported update to "updates" directory for EAS testing
  await fs.rename(path.join(projectRoot, 'dist'), path.join(projectRoot, 'updates'));

  // remove yarn.lock so yarn will work on EAS
  await fs.rm(path.join(projectRoot, 'yarn.lock'));

  // Copy Detox test file to e2e/tests directory
  await fs.copyFile(
    path.resolve(dirName, '..', 'fixtures', 'Updates-assets.e2e.js'),
    path.join(projectRoot, 'e2e', 'tests', 'Updates-assets.e2e.js')
  );
}

module.exports = {
  initAsync,
  setupBasicAppAsync,
  setupAssetsAppAsync,
};
