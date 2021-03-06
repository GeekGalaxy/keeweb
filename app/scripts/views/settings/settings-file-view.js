'use strict';

var Backbone = require('backbone'),
    FeatureDetector = require('../../util/feature-detector'),
    PasswordGenerator = require('../../util/password-generator'),
    Alerts = require('../../comp/alerts'),
    Launcher = require('../../comp/launcher'),
    Storage = require('../../storage'),
    Links = require('../../const/links'),
    Format = require('../../util/format'),
    Locale = require('../../util/locale'),
    UrlUtil = require('../../util/url-util'),
    kdbxweb = require('kdbxweb'),
    FileSaver = require('filesaver');

var SettingsFileView = Backbone.View.extend({
    template: require('templates/settings/settings-file.hbs'),

    events: {
        'click .settings__file-button-save-default': 'saveDefault',
        'click .settings__file-button-save-choose': 'toggleChooser',
        'click .settings__file-button-close': 'closeFile',
        'click .settings__file-save-to-file': 'saveToFile',
        'click .settings__file-save-to-xml': 'saveToXml',
        'click .settings__file-save-to-storage': 'saveToStorage',
        'change #settings__file-key-file': 'keyFileChange',
        'click #settings__file-file-select-link': 'triggerSelectFile',
        'change #settings__file-file-select': 'fileSelected',
        'focus #settings__file-master-pass': 'focusMasterPass',
        'input #settings__file-master-pass': 'changeMasterPass',
        'blur #settings__file-master-pass': 'blurMasterPass',
        'input #settings__file-name': 'changeName',
        'input #settings__file-def-user': 'changeDefUser',
        'change #settings__file-trash': 'changeTrash',
        'input #settings__file-hist-len': 'changeHistoryLength',
        'input #settings__file-hist-size': 'changeHistorySize',
        'input #settings__file-key-rounds': 'changeKeyRounds',
        'input #settings__file-key-change-force': 'changeKeyChangeForce'
    },

    appModel: null,

    initialize: function() {
        this.listenTo(this.model, 'change:syncing change:syncError change:syncDate', this.deferRender);
    },

    render: function() {
        var storageProviders = [];
        var fileStorage = this.model.get('storage');
        Object.keys(Storage).forEach(function(name) {
            var prv = Storage[name];
            if (!prv.system && prv.enabled && name !== fileStorage) {
                storageProviders.push(prv);
            }
        });
        storageProviders.sort(function(x, y) { return (x.uipos || Infinity) - (y.uipos || Infinity); });
        this.renderTemplate({
            cmd: FeatureDetector.actionShortcutSymbol(true),
            supportFiles: !!Launcher,
            desktopLink: Links.Desktop,
            name: this.model.get('name'),
            path: this.model.get('path'),
            storage: this.model.get('storage'),
            syncing: this.model.get('syncing'),
            syncError: this.model.get('syncError'),
            syncDate: Format.dtStr(this.model.get('syncDate')),
            password: PasswordGenerator.present(this.model.get('passwordLength')),
            defaultUser: this.model.get('defaultUser'),
            recycleBinEnabled: this.model.get('recycleBinEnabled'),
            historyMaxItems: this.model.get('historyMaxItems'),
            historyMaxSize: Math.round(this.model.get('historyMaxSize') / 1024 / 1024),
            keyEncryptionRounds: this.model.get('keyEncryptionRounds'),
            keyChangeForce: this.model.get('keyChangeForce') > 0 ? this.model.get('keyChangeForce') : null,
            storageProviders: storageProviders
        });
        if (!this.model.get('created')) {
            this.$el.find('.settings__file-master-pass-warning').toggle(this.model.get('passwordChanged'));
        }
        this.renderKeyFileSelect();
    },

    renderKeyFileSelect: function() {
        var keyFileName = this.model.get('keyFileName'),
            oldKeyFileName = this.model.get('oldKeyFileName'),
            keyFileChanged = this.model.get('keyFileChanged');
        var sel = this.$el.find('#settings__file-key-file');
        sel.html('');
        if (keyFileName && keyFileChanged) {
            var text = keyFileName !== 'Generated' ? Locale.setFileUseKeyFile + ' ' + keyFileName : Locale.setFileUseGenKeyFile;
            $('<option/>').val('ex').text(text).appendTo(sel);
        }
        if (oldKeyFileName) {
            var useText = keyFileChanged ? Locale.setFileUseOldKeyFile : Locale.setFileUseKeyFile + ' ' + oldKeyFileName;
            $('<option/>').val('old').text(useText).appendTo(sel);
        }
        $('<option/>').val('gen').text(Locale.setFileGenKeyFile).appendTo(sel);
        $('<option/>').val('none').text(Locale.setFileDontUseKeyFile).appendTo(sel);
        if (keyFileName && keyFileChanged) {
            sel.val('ex');
        } else if (!keyFileName) {
            sel.val('none');
        } else if (oldKeyFileName && keyFileName === oldKeyFileName && !keyFileChanged) {
            sel.val('old');
        }
    },

    validatePassword: function(continueCallback) {
        if (!this.model.get('passwordLength')) {
            var that = this;
            Alerts.yesno({
                header: Locale.setFileEmptyPass,
                body: Locale.setFileEmptyPassBody,
                success: function() {
                    continueCallback();
                },
                cancel: function() {
                    that.$el.find('#settings__file-master-pass').focus();
                }
            });
            return false;
        }
        return true;
    },

    save: function(arg) {
        var that = this;
        if (!arg) {
            arg = {};
        }
        arg.startedByUser = true;
        if (!arg.skipValidation) {
            var isValid = this.validatePassword(function() {
                arg.skipValidation = true;
                that.save(arg);
            });
            if (!isValid) {
                return;
            }
        }
        this.appModel.syncFile(this.model, arg);
    },

    saveDefault: function() {
        this.save();
    },

    toggleChooser: function() {
        this.$el.find('.settings__file-save-choose').toggleClass('hide');
    },

    saveToFile: function(skipValidation) {
        if (skipValidation !== true && !this.validatePassword(this.saveToFile.bind(this, true))) {
            return;
        }
        var fileName = this.model.get('name') + '.kdbx';
        var that = this;
        if (Launcher && !this.model.get('storage')) {
            Launcher.getSaveFileName(fileName, function (path) {
                if (path) {
                    that.save({storage: 'file', path: path});
                }
            });
        } else {
            this.model.getData(function (data) {
                if (Launcher) {
                    Launcher.getSaveFileName(fileName, function (path) {
                        if (path) {
                            Storage.file.save(path, data, function (err) {
                                if (err) {
                                    Alerts.error({
                                        header: Locale.setFileSaveError,
                                        body: Locale.setFileSaveErrorBody + ' ' + path + ': \n' + err
                                    });
                                }
                            });
                        }
                    });
                } else {
                    var blob = new Blob([data], {type: 'application/octet-stream'});
                    FileSaver.saveAs(blob, fileName);
                }
            });
        }
    },

    saveToXml: function() {
        this.model.getXml((function(xml) {
            var blob = new Blob([xml], {type: 'text/xml'});
            FileSaver.saveAs(blob, this.model.get('name') + '.xml');
        }).bind(this));
    },

    saveToStorage: function(e) {
        if (this.model.get('syncing') || this.model.get('demo')) {
            return;
        }
        var storageName = $(e.target).closest('.settings__file-save-to-storage').data('storage');
        var storage = Storage[storageName];
        if (!storage) {
            return;
        }
        var that = this;
        if (that.model.get('storage') === storageName) {
            that.save();
        } else {
            if (!storage.list) {
                if (storage.name === 'webdav') {
                    Alerts.info({
                        icon: storage.icon,
                        header: Locale.setFileNoWebDavUpload,
                        body: Locale.setFileNoWebDavUploadBody
                    });
                } else {
                    Alerts.notImplemented();
                }
                return;
            }
            that.model.set('syncing', true);
            storage.list(function(err, files) {
                that.model.set('syncing', false);
                if (err) {
                    return;
                }
                var expName = that.model.get('name').toLowerCase();
                var existingFile = _.find(files, function(file) {
                    return UrlUtil.getDataFileName(file.name).toLowerCase() === expName;
                });
                if (existingFile) {
                    Alerts.yesno({
                        header: Locale.setFileAlreadyExists,
                        body: Locale.setFileAlreadyExistsBody.replace('{}', that.model.escape('name')),
                        success: function() {
                            that.model.set('syncing', true);
                            storage.remove(existingFile.path, function(err) {
                                that.model.set('syncing', false);
                                if (!err) {
                                    that.save({storage: storageName});
                                }
                            });
                        }
                    });
                } else {
                    that.save({storage: storageName});
                }
            });
        }
    },

    closeFile: function() {
        if (this.model.get('modified')) {
            var that = this;
            Alerts.yesno({
                header: Locale.setFileUnsaved,
                body: Locale.setFileUnsavedBody,
                buttons: [
                    {result: 'close', title: Locale.setFileCloseNoSave, error: true},
                    {result: '', title: Locale.setFileDontClose}
                ],
                success: function(result) {
                    if (result === 'close') {
                        that.closeFileNoCheck();
                    }
                }
            });
        } else {
            this.closeFileNoCheck();
        }
    },

    closeFileNoCheck: function() {
        this.appModel.closeFile(this.model);
    },

    keyFileChange: function(e) {
        switch (e.target.value) {
            case 'old':
                this.selectOldKeyFile();
                break;
            case 'gen':
                this.generateKeyFile();
                break;
            case 'none':
                this.clearKeyFile();
                break;
        }
    },

    selectOldKeyFile: function() {
        this.model.resetKeyFile();
        this.renderKeyFileSelect();
    },

    generateKeyFile: function() {
        var keyFile = this.model.generateAndSetKeyFile();
        var blob = new Blob([keyFile], {type: 'application/octet-stream'});
        FileSaver.saveAs(blob, this.model.get('name') + '.key');
        this.renderKeyFileSelect();
    },

    clearKeyFile: function() {
        this.model.removeKeyFile();
        this.renderKeyFileSelect();
    },

    triggerSelectFile: function() {
        this.$el.find('#settings__file-file-select').click();
    },

    fileSelected: function(e) {
        var file = e.target.files[0];
        var reader = new FileReader();
        reader.onload = (function(e) {
            var res = e.target.result;
            this.model.setKeyFile(res, file.name);
            this.renderKeyFileSelect();
        }).bind(this);
        reader.readAsArrayBuffer(file);
    },

    focusMasterPass: function(e) {
        e.target.value = '';
        e.target.setAttribute('type', 'text');
    },

    changeMasterPass: function(e) {
        if (!e.target.value) {
            this.model.resetPassword();
            this.$el.find('.settings__file-master-pass-warning').hide();
        } else {
            this.model.setPassword(kdbxweb.ProtectedValue.fromString(e.target.value));
            if (!this.model.get('created')) {
                this.$el.find('.settings__file-master-pass-warning').show();
            }
        }
    },

    blurMasterPass: function(e) {
        if (!e.target.value) {
            this.model.resetPassword();
            e.target.value = PasswordGenerator.present(this.model.get('passwordLength'));
            this.$el.find('.settings__file-master-pass-warning').hide();
        }
        e.target.setAttribute('type', 'password');
    },

    changeName: function(e) {
        var value = $.trim(e.target.value);
        if (!value) {
            return;
        }
        this.model.setName(value);
    },

    changeDefUser: function(e) {
        var value = $.trim(e.target.value);
        this.model.setDefaultUser(value);
    },

    changeTrash: function(e) {
        this.model.setRecycleBinEnabled(e.target.checked);
    },

    changeHistoryLength: function(e) {
        var value = +e.target.value;
        if (isNaN(value)) {
            e.target.value = this.model.get('historyMaxItems');
            return;
        }
        this.model.setHistoryMaxItems(value);
    },

    changeHistorySize: function(e) {
        var value = +e.target.value;
        if (isNaN(value)) {
            e.target.value = this.model.get('historyMaxSize') / 1024 / 1024;
            return;
        }
        this.model.setHistoryMaxSize(value * 1024 * 1024);
    },

    changeKeyRounds: function(e) {
        var value = +e.target.value;
        if (isNaN(value)) {
            e.target.value = this.model.get('keyEncryptionRounds');
            return;
        }
        this.model.setKeyEncryptionRounds(value);
    },

    changeKeyChangeForce: function(e) {
        var value = Math.round(e.target.value);
        if (isNaN(value) || value <= 0) {
            value = -1;
        }
        this.model.setKeyChange(true, value);
    }
});

module.exports = SettingsFileView;
