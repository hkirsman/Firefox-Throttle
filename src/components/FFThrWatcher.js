/***********************************************************
Constants
***********************************************************/
const CLASS_ID = Components.ID("{0C085B6F-498D-4DC1-B63A-226806F121D6}");
const CLASS_NAME = "Firefox Throttle Watcher Service";
const CONTRACT_ID = "@uselessapplications.com/ffthrwatcher;1";

const Cc = Components.classes;
const Ci = Components.interfaces;

const INBOUND = 0;
const OUTBOUND = 1;
const UNLIMITED_CPS = -1;

/***********************************************************
Component
***********************************************************/
function Component() {
	this.wrappedJSObject = this;

	this.preferences = Cc["@mozilla.org/preferences-service;1"]
		.getService(Ci.nsIPrefService)
		.getBranch("extensions.ffthrottle.");
	this.preferences.QueryInterface(Ci.nsIPrefBranch2);

	this.stats = Cc["@mozilla.org/preferences-service;1"]
		.getService(Ci.nsIPrefService)
		.getBranch("extensions.ffthrottlestats.");
	this.stats.QueryInterface(Ci.nsIPrefBranch2);

	this.observer = Cc["@mozilla.org/observer-service;1"]
		.getService(Ci.nsIObserverService);
		
	this.preferences.addObserver("", this, false);
	this.observer.addObserver(this, "quit-application", false);

	this.timer = Components.classes["@mozilla.org/timer;1"]
		.createInstance(Components.interfaces.nsITimer);
	this.timer.initWithCallback(this, 1000, Ci.nsITimer.TYPE_REPEATING_SLACK);

    this.showStatusPanel = this.preferences.getBoolPref("showStatusPanel");

	this.throttlingService = Components.classes["@uselessapplications.com/ffthrottle;1"].getService(Components.interfaces.IFFThrottleAgent);
	
    this.lastInboundCPS = 0;
    this.lastOutboundCPS = 0;

    this.qtInboundPreset = 0;
    this.qtInboundLimit = UNLIMITED_CPS;
    this.qtOutboundPreset = 0;
    this.qtOutboundLimit = UNLIMITED_CPS;
    
    this.inboundCounter = 0;
    this.outboundCounter = 0;
    
    this.histInboundCounter =parseFloat(this.stats.getCharPref("totalInboundTraffic"));
    if (isNaN(this.histInboundCounter))
        this.histInboundCounter = 0.0;
        
    this.histOutboundCounter = parseFloat(this.stats.getCharPref("totalOutboundTraffic"));
    if (isNaN(this.histOutboundCounter))
        this.histOutboundCounter = 0.0;

    this.lastSavedTraffic = new Date().getTime();
        
    this.initThrottling();	
}

Component.prototype = {

    initThrottling: function() {
        try
        {
            bRecvEnable = this.preferences.getBoolPref("throttledownload");
            bSendEnable = this.preferences.getBoolPref("throttleupload");
            lRecvLimit = this.preferences.getIntPref("maxdownloadcps");
            lSendLimit = this.preferences.getIntPref("maxuploadcps");
            lRecvPresetId = this.preferences.getIntPref("downloadpreset");
            lSendPresetId = this.preferences.getIntPref("uploadpreset");
            bExcludeLANs = this.preferences.getBoolPref("autoexcludelans");
            bEnableBursting = this.preferences.getBoolPref("enableBursting");
            strExcludeRanges = this.preferences.getCharPref("excludedIPs");
            strExcludedDomains = this.preferences.getCharPref("excludedDomains");

            bThrottleLocalhostPortsEnabled = this.preferences.getBoolPref("throttleLocalhostPortsEnabled");
            strThrottleLocalhostPorts =  this.preferences.getCharPref("throttleLocalhostPorts");
	   	    bNegateExcludedIPs = this.preferences.getBoolPref("negateExcludedIPs");
            bNegateExcludedDomains = this.preferences.getBoolPref("negateExcludedDomains");

            this.throttlingService.resetLocalIPRanges(bExcludeLANs);
            this.throttlingService.ExcludedIPRanges = strExcludeRanges;
            this.throttlingService.ExcludedDomains = strExcludedDomains;
            
            if (bThrottleLocalhostPortsEnabled)
            {
                if (strThrottleLocalhostPorts.length > 0)
                    this.throttlingService.ThrottledLocalhostPorts = strThrottleLocalhostPorts;
                else
                    this.throttlingService.ThrottledLocalhostPorts = "0";
            }

            this.throttlingService.NegateRangesExclude = bNegateExcludedIPs;
            this.throttlingService.NegateDomainsExclude = bNegateExcludedDomains;

            
            this.throttlingService.BurstingEnabled = bEnableBursting;
        	
            if (bRecvEnable)
            {
	            this.throttlingService.setMaxCPS(INBOUND, lRecvLimit, lRecvPresetId);
	            this.qtInboundLimit = lRecvLimit;
            }
            else
            {
	            this.throttlingService.setMaxCPS(INBOUND, UNLIMITED_CPS, lRecvPresetId);
            }

            this.qtInboundPreset = lRecvPresetId;

            if (bSendEnable)
            {
	            this.throttlingService.setMaxCPS(OUTBOUND, lSendLimit, lSendPresetId);
	            this.qtOutboundLimit = lSendLimit;
            }
            else
            {
	            this.throttlingService.setMaxCPS(OUTBOUND, UNLIMITED_CPS, lSendPresetId);
            }

            this.qtOutboundPreset = lSendPresetId;

            if (!bSendEnable && !bRecvEnable)
            {
              //Use defaults as quick toggle params
	            this.qtOutboundLimit = lSendLimit;
	            this.qtInboundLimit = lRecvLimit;
            }
        }
        catch (e)
        {
            this.debug(e);
        }
    	
    },
	broadcastConfigChange: function() {
		this.observer.notifyObservers(this, "ffthrottle-update", "config");
	},

	setQuickToggleSettings: function (nMaxRecv, nRecvPresetId, nMaxSend, nSendPresetId)
	{
        this.qtInboundPreset = nRecvPresetId;
        this.qtInboundLimit = nMaxRecv;
        this.qtOutboundPreset = nSendPresetId;
        this.qtOutboundLimit = nMaxSend;
	},
    
    resetCounters: function() {
        this.inboundCounter = 0;
        this.outboundCounter = 0;
        this.throttlingService.resetTrafficCounter(INBOUND);
        this.throttlingService.resetTrafficCounter(OUTBOUND);
		this.observer.notifyObservers(this, "ffthrottle-update", "cps");
    },
    
    resetHistoryCounters: function() {
        this.histInboundCounter = 0.0;
        this.histOutboundCounter = 0.0;
        this.stats.setCharPref("totalTrafficSince", new Date().getTime());
        this.saveTrafficCounters();
		this.observer.notifyObservers(this, "ffthrottle-update", "cps");       
    },

    saveTrafficCounters: function() {
        this.stats.setCharPref("totalInboundTraffic", this.histInboundCounter);
        this.stats.setCharPref("totalOutboundTraffic", this.histOutboundCounter);
        this.lastSavedTraffic = new Date().getTime();
    },

	quickToggleThrottling: function() {

        var nMaxRecv = this.throttlingService.getMaxCPS(INBOUND);
        var bRecvEnabled = nMaxRecv != UNLIMITED_CPS;
        var nRecvPresetId = this.throttlingService.getPresetId(INBOUND);
	    
	    var nMaxSend = this.throttlingService.getMaxCPS(OUTBOUND);
	    var bSendEnabled = nMaxSend != UNLIMITED_CPS;
	    var nSendPresetId = this.throttlingService.getPresetId(OUTBOUND);

        if (!bRecvEnabled && !bSendEnabled)
        {
           //Enable throttling, restore quick toggle settings
           this.throttlingService.setMaxCPS(INBOUND, this.qtInboundLimit, this.qtInboundPreset);
           this.throttlingService.setMaxCPS(OUTBOUND, this.qtOutboundLimit, this.qtOutboundPreset);
        }
        else
		{

			//Save current settings as quick settings
        	this.qtInboundPreset = nRecvPresetId;
        	this.qtInboundLimit = nMaxRecv;
        	this.qtOutboundPreset = nSendPresetId;
        	this.qtOutboundLimit = nMaxSend;

			//Disable all throttling
        	this.throttlingService.setMaxCPS(INBOUND, UNLIMITED_CPS, nRecvPresetId);
        	this.throttlingService.setMaxCPS(OUTBOUND, UNLIMITED_CPS, nSendPresetId);
		}
    
        this.broadcastConfigChange();
	},

	notify: function(aTimer) {

        this.lastInboundCPS = this.throttlingService.getAverageCPS(INBOUND, 1000);
        this.lastOutboundCPS = this.throttlingService.getAverageCPS(OUTBOUND, 1000);
        
        newInboundBytes = this.throttlingService.getTrafficCounter(INBOUND);
        oldInbound = this.inboundCounter;
        this.inboundCounter = newInboundBytes / 1024.0;
        this.histInboundCounter += (this.inboundCounter - oldInbound);
        
        newOutboundBytes = this.throttlingService.getTrafficCounter(OUTBOUND);
        oldOutbound = this.outboundCounter;
        this.outboundCounter = newOutboundBytes / 1024.0;
        this.histOutboundCounter += (this.outboundCounter - oldOutbound);

        var dtnow = new Date();
        if ((dtnow.getTime() - this.lastSavedTraffic) > 60000)
        {
            this.saveTrafficCounters();
        }
            
		this.observer.notifyObservers(this, "ffthrottle-update", "cps");
	},
	observe: function(aSubject, aTopic, aData) {
		switch (aTopic) {
			case "nsPref:changed":
			{
			    switch (aData) {
			        case "showStatusPanel":
			            this.showStatusPanel = this.preferences.getBoolPref("showStatusPanel");
			            this.observer.notifyObservers(this, "ffthrottle-update", "ui");
			        break;
			    }
				break;
			}
			case "quit-application":
			{
				this.preferences.removeObserver("", this);
				this.observer.removeObserver(this, "quit-application");
				this.saveTrafficCounters();
				break;
			}
		}
	},

	debug: function(aMessage) {
		Cc['@mozilla.org/consoleservice;1']
			.getService(Ci.nsIConsoleService)
			.logStringMessage(CLASS_NAME + "\n" + aMessage);
	},
	
	QueryInterface: function(aIID)
	{
		if (!aIID.equals(Ci.nsISupports))
			throw Components.results.NS_ERROR_NO_INTERFACE;
		return this;
	}
};


/***********************************************************
XPCOM
***********************************************************/
var Factory = {
	createInstance: function (aOuter, aIID)
	{
		if (aOuter != null)
			throw Components.results.NS_ERROR_NO_AGGREGATION;
		return (new Component()).QueryInterface(aIID);
	}
};
var Module = {
	registerSelf: function(aCompMgr, aFileSpec, aLocation, aType)
	{
		aCompMgr = aCompMgr.
				QueryInterface(Ci.nsIComponentRegistrar);
		aCompMgr.registerFactoryLocation(CLASS_ID, CLASS_NAME, 
				CONTRACT_ID, aFileSpec, aLocation, aType);
	},

	unregisterSelf: function(aCompMgr, aLocation, aType)
	{
		aCompMgr = aCompMgr.
				QueryInterface(Ci.nsIComponentRegistrar);
		aCompMgr.unregisterFactoryLocation(CLASS_ID, aLocation);				
	},
	
	getClassObject: function(aCompMgr, aCID, aIID)
	{
		if (!aIID.equals(Ci.nsIFactory))
			throw Components.results.NS_ERROR_NOT_IMPLEMENTED;

		if (aCID.equals(CLASS_ID))
			return Factory;

		throw Components.results.NS_ERROR_NO_INTERFACE;
	},

	canUnload: function(aCompMgr) { return true; }
};

function NSGetModule(aCompMgr, aFileSpec) { return Module; }
