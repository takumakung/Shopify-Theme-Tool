YUI().use('view','panel', 'event-custom','event-focus','node-event-simulate','array-extras', function(Y) { 
///start

var IO = YUI.namespace('Themer.IO');

Themer.appView = Y.Base.create('appView', Y.View, [], {
   
    container: Y.one('body'),

    //These events are app wide - hooked off body
    events: {
        //General External Link handler. Open in browser window.
        'a.external': { click: function(e) {
            e.halt(true);
            Titanium.Platform.openURL(e.currentTarget.get('href'));

            //from bootstrap :/ because we halt the event, 
            //we need to manually close the dropdown. grrr...
            $('[data-toggle="dropdown"]').parent().removeClass('open');
        }},
        'a#reload': { click: function(e) {
            e.halt(true);
            window.location.reload(true);
        }},
        
        '.add-shop' : { click: 'addShop'},
        'ul.themes li': { contextmenu: function(e) {
            e.stopPropagation();

            var li = e.currentTarget,
                currentMenu = Ti.UI.createMenu(),
                shops = this.shops;

            var openFolder = Ti.UI.createMenuItem('Open In Finder', function() {
                li.one('.path').simulate('click');
            });
            
            var forceDeploy = Ti.UI.createMenuItem('Force Deploy', function() {
                Ti.API.warn('Force Deploy TK');
                
                if(confirm("Are you sure you want to upload this theme?")) {
                    var themeId = li.get('id').replace('theme-', '');

                    //go through the shops, look for the theme model of interest
                    shops.some(function(shopModel) {
                        var themeModel = shopModel.themes.getById(themeId);
                        if(themeModel) {
                            uploadThemeActivity(themeModel);
                            IO.deployTheme(shopModel, themeModel);
                            return true;
                        }
                        return false;
                    });
                }

            });

            currentMenu.appendItem(openFolder);
            currentMenu.appendItem(forceDeploy);
            Ti.UI.setContextMenu(currentMenu);
        }}
    },
   
    initializer: function() {
        console.log('appView: Initializer');

        var shops = this.shops = new Themer.shopList();
        shops.after('add', this.add, this);
        shops.after('remove', this.remove, this);        

        //Reset also fires on initial model list load. 
        shops.after('reset', this.render, this);

        shops.load();

        //Custom event that gets the new shop data from form
        //Creates the redirect URL to get the perms, and sends user there
        Y.on('addShopOk', function(shopData) {
            console.log('appView: addShopOk');
            // Ti.API.warn(shopData);
            connectingPanel().show();
            //Spin down any watchers
            Y.Global.fire('watch:killall');
            window.location = IO.authUrl(shopData.id);
            // this.shops.create(shopData);
        }, this);
    },

    render: function(e) {
        console.log('appView: render');

        if(this.shops.isEmpty()) {
            console.log('No Shops! Show Onboard!');
            Y.one('#no-shops').removeClass('hide');
            this.addShop();
            return this;
        }

        Y.one('#no-shops').addClass('hide');

        var fragment = Y.one(Y.config.doc.createDocumentFragment());

        Y.Array.each(e.models, function (model, index) {
            console.log('render shop id:' + model.get('id'));
            var view = new Themer.ShopView({
                model: model,
                container: Y.Lang.sub(Y.one('#shop-template').getContent(), {
                    store: model.get('id'),
                    'class': (index == 0) ? 'active':''
                })
            });
            
            fragment.append(view.render().container);
        });

        this.container.one('#shops').setContent(fragment);

        return this;
    },
   
    // Click handler for the add shop button
    addShop: function(e) {
        //Setup the Add Shop form overlay
        this.addShopForm = this.addShopForm || createAddShopPanel();        
        this.addShopForm.show();
    }, 

    //Called when shop added to the shops list
    add: function(e) {
        console.log('appView: New Shop Added');
        //If its showing, hide it...
        if(this && this.AddShopForm){ this.addShopForm.hide(); }
        Y.one('#no-shops').addClass('hide');
        var view = new Themer.ShopView({
            model: e.model,
            container: Y.Lang.sub(
                Y.one('#shop-template').getContent(), {store: e.model.get('id'), 'class': ''}
            )
        });
        
        this.container.one('#shops').append(view.render().container);
        
        view.chooseTheme();
        
    },

    remove: function(e) {
        console.log('appView: Shop Removed');
        if(this.shops.isEmpty()) {
            Y.one('#no-shops').removeClass('hide');
        } else {
            Y.Global.fire('shop:switch', {
              container: Y.one('#shops'), 
              currentTarget: Y.one('#'+this.shops.item(0).get('id'))
            });
        }
    }

});

var createAddShopPanel = function() {

    var panel = new Y.Panel({
        srcNode: '#add-shop-panel',
        width: 500, 
        centered: true,
        visible: false,
        modal: true,
        headerContent: '<h3>Add a New Shop</h3>',
        zIndex: 10
    });
    
    panel.addButton({
        value: 'Cancel',
        action: function(e) {
            e.preventDefault(); 
            panel.hide();
        },
        classNames: 'btn',
        section: Y.WidgetStdMod.FOOTER
    });


    panel.addButton({
         id: 'addShopOk',
         value: 'Add Shop',
         action: function(e) {
             e.preventDefault(); 

             //Step through and remove all unwanted crap that may be submitted
             var sanitizeShopId = function(str) {
                 var sid = str.replace('http://', '', 'i') 
                           .replace('https://', '', 'i') //In case someone uses https://
                           .replace('.myshopify.com', '', 'i')
                           .replace('/',''); //#fixes public issue #10 - trailing slash
                           
                return Y.Lang.trim(sid);
             };

             var data = {
                 id: sanitizeShopId(Y.one('input[name=id]').get('value'))
             };
             
             if(data.id.length == '') {
                 panel.hide();
             }
             else {
                 Y.fire('addShopOk', data);                 
             }
         },
         classNames: 'btn btn-primary',
         section: Y.WidgetStdMod.FOOTER
     });


    panel.render();
    Y.one('#add-shop-panel').removeClass('hide');

    return panel;
};


Themer.ShopView = Y.Base.create('shopView', Y.View, [], {

    //Will pass in a custom container at instantiation
    //    <div id='{store}' class='shop-themes'></div>
    // container: Y.one('#shop-template').getContent(), 
    template: '{store}',
    
    initializer: function() {
        console.log('ShopView: initializer');
        var model = this.model;
        //@todo clean up themes when shop destroyed
        // model.after('destroy', this.destroy, this);
        
        var themes = model.themes = new Themer.themeList();
        themes.parent_id = model.get('id');

        themes.after('add', this.addTheme, this);
        // themes.after('remove', this.remove, this);

        themes.load();
        
    },
    
    render: function() {
        Y.log('Render Shopview');
        var container = this.container, 
            model = this.model,
            store = this.model.get('id');
            
        container.setContent(Y.Lang.sub(this.template, {
            store: store
        }));

        //Create the Theme container, since its not created with the shop anymore
        //(its in a different part of the dom...)
        Y.one('div#themes-container').append(Y.Lang.sub(
            Y.one('#shop-themes-wrapper').getContent(), {
                store: store,
                'class': (container.hasClass('active')) ? 'theme-show' : 'theme-hide'
            }
        ));

        //Handle no themes on the active theme created at init...
        if(model.themes.isEmpty() && container.hasClass('active')) {
          Y.one('div#themes-'+store).append(Y.one('#no-themes'));
          Y.one('#no-themes').removeClass('hide');
        } 

        //If themes, empty, does nothing, so we dont bother with if/else
        model.themes.each(function(theme) {
            // console.log(item.toJSON());
            var view = new Themer.ThemeView({
                model: theme
            });
            
            Y.one('div#themes-'+store+" .theme-list").append(view.render().container);
            // fragment.append(view.render().container);
        });
        
        //add delegate to listen for Add Theme button press
        Y.one('div#themes-'+store).delegate('click', 
            this.chooseTheme, 
            '.add-theme', 
            {'model': model} //Add some context
        );
        
        Y.one('div#themes-'+store).delegate('click', 
            this.remove, 
            '.remove-shop', 
            this //Add some context
        );


        return this;
    },
    
    remove: function(e) {
        console.log('ShopView:remove');
        //Delete the associated themes list view
        Y.one('#themes-'+this.model.get('id')).remove(true);

        this.constructor.superclass.remove.call(this);
        this.model.destroy({'delete': true});
    },

    //Called when theme added to the shop themes list
    addTheme: function(e) {
        console.log('shopView: New Theme Added');
        var shop = this.model,
            theme = e.model,
            themeList = Y.one('#themes-'+shop.get('id')+' .theme-list');

        var view = new Themer.ThemeView({
            model: theme
        });

        var existing = themeList.one('#theme-'+theme.get('id')),
            newNode = view.render().container;

        if(existing) {
            themeList.replaceChild(newNode, existing);
        } else {
            themeList.append(newNode);
        }
        
        Y.one('#no-themes').addClass('hide');

        //Throw up activity indicator.
        var panel = downloadThemeActivity(theme);

        //Create folder, if it doesn't exist
        var destinationDir = Titanium.Filesystem.getFile(theme.get('path'));
        if( (destinationDir.exists() == false) && (destinationDir.createDirectory() == false)) {
            alert('We could not create the download directory.');
            return;
        }
        
        //Before download, kill off any watchers on that theme 
        //otherwise we will have a right mess
        Themer.Watcher.kill(theme.get('id'));

        //Begin download.
        IO.downloadTheme(shop, theme);
        
        Y.Global.on('download:done', function(e) { 
            //Spin up a watcher
            Themer.Watcher.start(shop, theme);
        });
    },

    
    chooseTheme: function() {
        console.log('ShopView:chooseTheme');
        var ThisShopModel = this.model,
            shopWorkingThemes = ThisShopModel.themes;

        //Open Panel
        var panel = createThemePicker();
        //Fetch Themes
        IO.fetchThemesList(ThisShopModel, {

            success: function(resp) {
                // console.log('Success!');
                // console.log(resp);
                
                var result = JSON.parse(resp.responseText),
                    themeList = Y.Node.create('<ul class="theme-picker"></ul>');
                
                result.themes.forEach(function(item) {
                    var li = Y.Lang.sub('<li id="theme-{id}">{name} [{role}]</li>', item);
                    themeList.append(li);
                });
                
                themeList.delegate('click', function(e) {
                    // console.log(e);
                    var selectedId = e.currentTarget.get('id').replace('theme-', '');
                    
                    var selectedTheme = Y.Array.find(result.themes, function(item) {
                        return (item.id == selectedId);
                    });
                    selectedTheme.parent_id = ThisShopModel.get('id');

                    panel.hide();
                    panel.destroy();
                    
                    //Show folder picker
                    Titanium.UI.currentWindow.openFolderChooserDialog(function(dir) {
                        if(dir.length == 0) { return false; }
                        selectedTheme.path = dir[0].concat(Ti.Filesystem.getSeparator(), selectedTheme.parent_id, '-', selectedTheme.id);
                        shopWorkingThemes.create(selectedTheme);
                        return true;
                    },
                    {
                        title: 'Choose Download Location',
                        multiple:false,
                        directories:true,
                        files:false});
                    
                }, 'li');

                panel.set('bodyContent', themeList);
                panel.set('centered', true); //to re-center
            },
            
            failure: function(resp) {
                console.log('Failure!');
                console.log(resp);
                var result = JSON.parse(resp.responseText);
                panel.set('bodyContent', result.errors || "Unknown Error");
            }
        });
        //On selection of theme, prompt with folder. 
        
    }
});

var createThemePicker = function(shopModel) {

    var panel = new Y.Panel({
        width: 400, 
        centered: true,
        visible: true,
        modal: true,
        headerContent: '<h3>Choose a theme</h3>',
        zIndex: 10,
        bodyContent: '<p>Loading themes for this Shop... Just a moment please</p>'
    });
    
    panel.render();
    
    return panel;
    
};

var downloadThemeActivity = function(themeModel) {

    var panel = new Y.Panel({
        width: 500, 
        centered: true,
        visible: true,
        modal: true,
        buttons: [], //no close button
        headerContent: '<h3>Download theme: '+ themeModel.get('name')+'</h3>',
        zIndex: 10,
        bodyContent: '<h4>Downloading files to:<br>'+ themeModel.get('path')+'</h4><div id="downstatus"></div>(^v^)/'
    });

    panel.addButton({
        value: 'Cancel',
        action: function(e) {
            e.preventDefault();
            Y.Global.fire('download:cancel');
        },
        classNames: 'btn',
        section: Y.WidgetStdMod.FOOTER
    });

    panel.render();
    panel.set('centered', true); //to re-center post render
    var assetDlHandle = Y.Global.on('asset:download', function(e) {
        Y.one('#downstatus').setContent(e.asset + '...');
    });

    var ddHandle = Y.Global.once('download:done', function(e) { 
        //cleanup
        assetDlHandle.detach();

        e = e || {};
        var cancelled = e.cancelled || false;
        panel.hide(); 
        var gmsg = {
            title: 'Download Done',
            message: 'The theme '+themeModel.get('name')+' is done downloading'
        };
        
        if(cancelled){
            gmsg = {
                title: 'Download Cancelled',
                message: 'Some files have been downloaded.'
            };
        } 
        growl(gmsg);
        cleanUp();
    });
    
    var deHandle = Y.Global.once('download:error', function(e) { 
        panel.hide(); 
        cleanUp(); 
    });

    var cleanUp = function() {
        ddHandle.detach();
        deHandle.detach();
        assetDlHandle.detach();
    };

    return panel;
    
};

var connectingPanel = function() {

    var panel = new Y.Panel({
        width: 300, 
        centered: true,
        visible: true,
        modal: true,
        buttons: [], //no close button
        zIndex: 12,
        srcNode: '#connecting-shopify-panel'
    });

    panel.render();
    Y.one('#connecting-shopify-panel').removeClass('hide');
    return panel;

};


///end
});
